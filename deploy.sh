#!/usr/bin/env bash
# Reproducible deploy for Tripwire: DynamoDB + SSM + IAM + Lambda (Function URL, Node 22) + PayPal webhook + S3 + CloudFront.
# Plain aws CLI. Safe to re-run.   ./deploy.sh            full deploy
#                                  ./deploy.sh --seed     also (re)load the stream into DynamoDB
#                                  ./deploy.sh --scan     also queue a first watcher scan once deployed
# Needs: aws (authenticated to the target account), node 22+, zip, curl. Reads ../../.env for the PayPal sandbox credentials.
set -euo pipefail
cd "$(dirname "$0")"
ACCOUNT=854924711083; REGION=us-east-1
export AWS_DEFAULT_REGION=$REGION AWS_PAGER=""
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || { echo "wrong AWS account"; exit 1; }
set -a; . ../../.env; set +a
TABLE=tripwire; FN=tripwire-api; ROLE=tripwire-lambda-role; BUCKET=tripwire-web-$ACCOUNT; SSM=/tripwire
SEED=0; SCAN=0; for a in "$@"; do [ "$a" = "--seed" ] && SEED=1; [ "$a" = "--scan" ] && SCAN=1; done
step() { printf '\n== %s\n' "$*"; }

step "Backend dependencies (dev only: the Lambda runtime provides the AWS SDK)"
(cd backend && npm ci --silent 2>/dev/null || npm i --silent)

step "DynamoDB table (on-demand, TTL on 'expires')"
aws dynamodb describe-table --table-name $TABLE >/dev/null 2>&1 || {
  aws dynamodb create-table --table-name $TABLE --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE >/dev/null
  aws dynamodb wait table-exists --table-name $TABLE
  aws dynamodb update-time-to-live --table-name $TABLE --time-to-live-specification Enabled=true,AttributeName=expires >/dev/null
}

step "SSM parameters (the PayPal secret is a SecureString and never lives in the repo or the Lambda environment)"
put() { aws ssm put-parameter --name "$SSM/$1" --value "$2" --type "${3:-String}" --overwrite >/dev/null; }
put PAYPAL_CLIENT_ID "$PAYPAL_CLIENT_ID"; put PAYPAL_SECRET "$PAYPAL_SECRET" SecureString; put PAYPAL_API "$PAYPAL_API"

step "IAM role"
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 8
fi
aws iam put-role-policy --role-name $ROLE --policy-name tripwire-access --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Query\",\"dynamodb:BatchWriteItem\"],\"Resource\":\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE\"},
 {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParametersByPath\",\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:$REGION:$ACCOUNT:parameter$SSM*\"},
 {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":\"*\"},
 {\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN\"}]}"
ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE

step "Package the Lambda (Node 22; AWS SDK v3 ships in the runtime, so nothing is bundled)"
node -e "const fs=require('fs');fs.rmSync('.build',{recursive:true,force:true});fs.mkdirSync('.build/backend/src',{recursive:true});fs.mkdirSync('.build/shared',{recursive:true});
for(const f of fs.readdirSync('backend/src'))if(f.endsWith('.mjs')&&f!=='local.mjs')fs.copyFileSync('backend/src/'+f,'.build/backend/src/'+f);
for(const f of fs.readdirSync('shared'))if(f.endsWith('.mjs'))fs.copyFileSync('shared/'+f,'.build/shared/'+f);
fs.writeFileSync('.build/package.json','{\"type\":\"module\"}');
fs.rmSync('function.zip',{force:true})"
(cd .build && zip -qr ../function.zip .)
ENVV="Variables={TABLE=$TABLE,SSM_PREFIX=$SSM/,BEDROCK_MODEL=$BEDROCK_MODEL}"
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --timeout 840 --memory-size 1024 --environment "$ENVV" >/dev/null
else
  aws lambda create-function --function-name $FN --runtime nodejs22.x --handler backend/src/lambda.handler --role $ROLE_ARN \
    --zip-file fileb://function.zip --timeout 840 --memory-size 1024 --environment "$ENVV" >/dev/null
fi
aws lambda wait function-updated --function-name $FN

step "Function URL (public; CORS open; the app only holds sandbox money)"
aws lambda get-function-url-config --function-name $FN >/dev/null 2>&1 || {
  aws lambda create-function-url-config --function-name $FN --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["*"],"AllowHeaders":["content-type"],"MaxAge":3600}' >/dev/null
  aws lambda add-permission --function-name $FN --statement-id url-public --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
}
node scripts/allow-url-invoke.mjs $FN
API_URL=$(aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text); API_URL=${API_URL%/}
echo "   $API_URL"

step "PayPal webhook (one of the free slots; events for the sibling projects on this app are acknowledged and ignored)"
WH_ID=$(aws ssm get-parameter --name $SSM/PAYPAL_WEBHOOK_ID --query Parameter.Value --output text 2>/dev/null || true)
TOK=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_SECRET" -d grant_type=client_credentials $PAYPAL_API/v1/oauth2/token | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
if [ -z "$WH_ID" ] || [ "$WH_ID" = None ]; then
  RES=$(curl -s -X POST $PAYPAL_API/v1/notifications/webhooks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"url\":\"$API_URL/api/webhook\",\"event_types\":[
   {\"name\":\"PAYMENT.PAYOUTSBATCH.PROCESSING\"},{\"name\":\"PAYMENT.PAYOUTSBATCH.SUCCESS\"},{\"name\":\"PAYMENT.PAYOUTSBATCH.DENIED\"},
   {\"name\":\"PAYMENT.PAYOUTS-ITEM.SUCCEEDED\"},{\"name\":\"PAYMENT.PAYOUTS-ITEM.UNCLAIMED\"},{\"name\":\"PAYMENT.PAYOUTS-ITEM.FAILED\"},{\"name\":\"PAYMENT.PAYOUTS-ITEM.BLOCKED\"},
   {\"name\":\"PAYMENT.PAYOUTS-ITEM.HELD\"},{\"name\":\"PAYMENT.PAYOUTS-ITEM.RETURNED\"},{\"name\":\"PAYMENT.PAYOUTS-ITEM.REFUNDED\"},
   {\"name\":\"INVOICING.INVOICE.PAID\"},{\"name\":\"INVOICING.INVOICE.CANCELLED\"},{\"name\":\"INVOICING.INVOICE.REFUNDED\"},
   {\"name\":\"PAYMENT.CAPTURE.COMPLETED\"},{\"name\":\"PAYMENT.CAPTURE.REFUNDED\"},{\"name\":\"CUSTOMER.DISPUTE.CREATED\"},{\"name\":\"CUSTOMER.DISPUTE.UPDATED\"},{\"name\":\"CUSTOMER.DISPUTE.RESOLVED\"}]}")
  WH_ID=$(echo "$RES" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id || ""')
  [ -n "$WH_ID" ] || { echo "webhook creation failed: $RES"; exit 1; }
  put PAYPAL_WEBHOOK_ID "$WH_ID"
  # SSM values are read at cold start, so bump an env var to recycle warm containers
  aws lambda update-function-configuration --function-name $FN --environment "Variables={TABLE=$TABLE,SSM_PREFIX=$SSM/,BEDROCK_MODEL=$BEDROCK_MODEL,CFG_REV=$(date +%s)}" >/dev/null
  aws lambda wait function-updated --function-name $FN
fi
echo "   webhook id $WH_ID"

if [ "$SEED" = 1 ]; then
  step "Load the stream into DynamoDB (replayed history + live sandbox objects from seed/live-manifest.json)"
  TABLE=$TABLE node scripts/load-local.mjs --dynamo
fi

step "Frontend build, S3 and CloudFront"
# Optional AG licence keys: set AG_GRID_LICENSE_KEY / AG_STUDIO_LICENSE_KEY in the shell or in ../../.env. Absent keys mean trial mode.
(cd frontend && (npm ci --silent 2>/dev/null || npm i --silent); VITE_API_URL=$API_URL VITE_AG_GRID_LICENSE_KEY="${AG_GRID_LICENSE_KEY:-}" VITE_AG_STUDIO_LICENSE_KEY="${AG_STUDIO_LICENSE_KEY:-}" npx vite build >/dev/null)
aws s3api head-bucket --bucket $BUCKET 2>/dev/null || {
  aws s3api create-bucket --bucket $BUCKET >/dev/null
  aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
}
aws s3 sync frontend/dist s3://$BUCKET --delete --cache-control 'no-cache' --exclude 'assets/*' >/dev/null
aws s3 sync frontend/dist/assets s3://$BUCKET/assets --cache-control 'public,max-age=31536000,immutable' >/dev/null
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='tripwire-web'].Id | [0]" --output text 2>/dev/null || true)
if [ -z "$DIST" ] || [ "$DIST" = None ]; then
  OAC=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='tripwire-oac'].Id | [0]" --output text)
  if [ -z "$OAC" ] || [ "$OAC" = None ]; then OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=tripwire-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --query OriginAccessControl.Id --output text); fi
  CACHE=$(aws cloudfront list-cache-policies --type managed --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingOptimized'].CachePolicy.Id | [0]" --output text)
  HDRS=$(aws cloudfront list-response-headers-policies --type managed --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='Managed-SecurityHeadersPolicy'].ResponseHeadersPolicy.Id | [0]" --output text)
  cat > .cf.json <<JSON
{"CallerReference":"tripwire-$(date +%s)","Comment":"tripwire-web","Enabled":true,"DefaultRootObject":"index.html","PriceClass":"PriceClass_100","HttpVersion":"http2and3",
 "Origins":{"Quantity":1,"Items":[{"Id":"s3","DomainName":"$BUCKET.s3.$REGION.amazonaws.com","OriginAccessControlId":"$OAC","S3OriginConfig":{"OriginAccessIdentity":""}}]},
 "DefaultCacheBehavior":{"TargetOriginId":"s3","ViewerProtocolPolicy":"redirect-to-https","Compress":true,"CachePolicyId":"$CACHE","ResponseHeadersPolicyId":"$HDRS","AllowedMethods":{"Quantity":2,"Items":["GET","HEAD"]}},
 "CustomErrorResponses":{"Quantity":2,"Items":[{"ErrorCode":403,"ResponsePagePath":"/index.html","ResponseCode":"200","ErrorCachingMinTTL":0},{"ErrorCode":404,"ResponsePagePath":"/index.html","ResponseCode":"200","ErrorCachingMinTTL":0}]}}
JSON
  DIST=$(aws cloudfront create-distribution --distribution-config file://.cf.json --query Distribution.Id --output text); node -e "require('fs').rmSync('.cf.json',{force:true})"
fi
DARN=arn:aws:cloudfront::$ACCOUNT:distribution/$DIST
aws s3api put-bucket-policy --bucket $BUCKET --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"cf\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"$DARN\"}}}]}"
aws cloudfront create-invalidation --distribution-id $DIST --paths '/*' >/dev/null
CF=$(aws cloudfront get-distribution --id $DIST --query Distribution.DomainName --output text)
printf '{"functionUrl":"%s","cloudfront":"https://%s","distribution":"%s","bucket":"%s","webhookId":"%s"}\n' "$API_URL" "$CF" "$DIST" "$BUCKET" "$WH_ID" > deploy-output.json

if [ "$SCAN" = 1 ]; then
  step "Queue the first watcher scan"
  curl -s -X POST "$API_URL/api/scan" -H 'content-type: application/json' -d '{}'; echo
fi
step "Done"; cat deploy-output.json
