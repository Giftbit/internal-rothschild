# internal-rothschild
POC banking implementation

## Connecting to the database

The database is in a VPC and not directly accessible through the internet.  There is a bastion host (aka jump box) that can only be reached from the office IP that can establish an SSH tunnel to the database.

1. If you're connecting to staging or production change `STACK_NAME` at the top of `dev.sh` to `staging-Rothschild` or `production-Rothschild` respectively.
2. `./dev.sh rdstunnel`
3. In your SQL client (like MySQL Workbench) connect to hostname "localhost" port "3306".  Username and password will depend upon the credentials.

If `/Volumes/credentials/ssh/AWSKey.pem` does not exist:

1. `ssh-keygen -t rsa -b 4096 -C "AWSKey" -f /Volumes/credentials/ssh/AWSKey.pem`
2. `aws iam upload-ssh-public-key --user-name <your aws user name> --ssh-public-key-body file:///Volumes/credentials/ssh/AWSKey.pem.pub`


## Testing

### Stripe tests

Requests to Stripe are mocked when running `npm run test`. 

#### Live Stripe tests

Environment variables are required to run live Stripe tests again. This is because we need to provide our own platform key, which we don't want to commit to the repo, as well as a connected account id (NOT api key), which we can and have committed. 

See `.env.example` for setup. 

Then use `npm run test:stripeLive` to run the live tests.   

To close the loop on live Stripe testing, check the cloudwatch logs in dev for the [`stripeEventWebhook` lambda](https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logStream:group=/aws/lambda/dev-Rothschild-StripeEventWebhookFunction-3Q03K92TO7QY;streamFilter=typeLogStreamPrefix) after running the unit tests. Look for successful signature verification and expected logging output. 

##### More details on Stripe setup to avoid future confusion

Two Stripe accounts have been set up to live test our Stripe integration: 

*Platform account*

Belongs to integrationtesting+stripedev@giftbit.com

This is a stand-in for the production Lightrail account. The config for this account is stored in S3; this is what will be fetched by calling `giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE")` in dev. 

The secret key for this account belongs in a `.env` file.  See `.env.example`.

*Merchant account*

Belongs to integrationtesting+merchant@giftbit.com

This is a stand-in for our customer's account. We place charges etc on their behalf using Stripe Connect. 

The stripeUserId (for the account header) and customer details (for making charges) in src/utils/testUtils/stripeTestUtils.ts are for this account. **Note, we do NOT need an API key for this account.**  We never use a merchant's API key directly, that's what Connect is for.  
