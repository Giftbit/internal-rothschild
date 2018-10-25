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
Requests to Stripe are mocked when running `npm run test`. Use `npm run test:stripeLive` to run tests and make live requests to Stripe.  