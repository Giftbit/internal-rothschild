# internal-rothschild
POC banking implementation

## Connecting to the database

The database is in a VPC and not directly accessible through the internet.  There is a bastion host (aka jump box) that can only be reached from the office IP that can establish an SSH tunnel to the database.

1. If you're connecting to staging or production change `STACK_NAME` at the top of `dev.sh` to `staging-Rothschild` or `production-Rothschild` respectively.
2. `./dev.sh rdstunnel`

If `/Volumes/credentials/ssh/AWSKey.pem` does not exist:

1. `ssh-keygen -t rsa -b 4096 -C "AWSKey" -f /Volumes/credentials/ssh/AWSKey.pem`
2. `aws iam upload-ssh-public-key --user-name <your aws user name> --ssh-public-key-body file:///Volumes/credentials/ssh/AWSKey.pem.pub`


## Testing

### Stripe tests

Running the tests for using Stripe in checkout makes live requests to Stripe's servers right now. This means that you need to set a couple of environment variables to make them work: fill in `.env-example` and save the file as `.env`.

#### Setting up a connected account

If you don't have a second account connected to your main Stripe account (in test mode), you can set one up by doing the following: 
- Make another dev-mode Stripe account (zero details needed here)
- Log out and log into your FIRST Stripe account (this will be the "platform" account) and go here: https://dashboard.stripe.com/account/applications/settings (make sure "Viewing test data" is toggled to "on")
- Click the "Test OAuth" button in the "Client IDs" section
- Copy & paste the URL into a private browser window
- Go through the OAuth flow with your second account. The last step is to make a `curl` call from the command line to confirm connecting the accounts. You will need the `stripe_user_id` from the response: this is the `STRIPE_CONNECTED_ACCOUNT_ID` in the .env file. 
