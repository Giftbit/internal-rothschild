# internal-rothschild
POC banking implementation

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