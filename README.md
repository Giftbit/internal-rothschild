# internal-rothschild
Banking implementation

## Architecture

Rothschild's architecture is defined in the [AWS SAM template](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-template-anatomy.html) file `infrastructure/sam.yaml`.

Rothschild is back by a MySQL-compatible RDS Aurora database.  Schema changes to the database happen automatically on deployment using migration files in the `src/lambdas/postDeploy/schema/` dir which is run by the PostDeploy lambda which calls Flyway to do the real work.  You can see the current schema in its entirety by running `npm run schema`.

Rothschild predates having the concept of Accounts and Users.  Originally there were users and that was it.  So on all the columns you'll find `userId` which is actually the ID of the Account that owns the object, and maybe a `createdBy` which is the ID of the User that created the object.  Adding to the confusion for all older users the ID of the Account and the ID of the first User is the same.  So it goes.

userIds come in two flavours: live and test.  Test mode userIds end in `-TEST` and live mode userIds don't.  Live mode data represents real money.  It may include gift cards sold that a company has a legal obligation to honour.  This data is sacred.

AutomaticVoid is a lambda that runs on a schedule and looks for pending transactions to void.

BinlogWatcher connects to the RDS Aurora instance as a binlog client (which is how read replicas keep up to date with changes to the master).  It watches for database changes and puts events on the LightrailEvent SNS topic.  This topic is how [Gutenberg](https://github.com/Giftbit/internal-gutenberg/) is notified of state changes (and how we were going to implement an activity log) while being loosely coupled.  BinlogWatcher keeps a small DynamoDB table to maintain its state between calls.

This BinlogWatcher architecture is an improvement upon a previous architecture where we put events on a stream on the application side.  Done that way events would occasionally go missing.  With this architecture we have at least once delivery which is really as good as you can do.

## Development

You'll need Node (tested with 10.16), Docker and aws-cli.  Install dependencies with `npm i`.

Run the unit tests with `npm run test`.  Run the linter with `npm run lint`.  I guess it doesn't really matter if you track mud on the carpet when the house is about to be town down anyways, but still, it feels rude.

Deploy to dev with `./dev.sh deploy`.  There are other commands in that script but you don't really need them.  Deploy to staging by committing to the staging branch and approving the CodePipeline in the staging AWS account.  When the staging deployment completes a PR from staging to master will be opened automatically.  Deploy to production by merging that PR and approving the CodePipeline in the production account.

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

## Connecting to the database

There are three users of the database: `readonly`, `binlogwatcher` and `master`.  The credentials for all three are stored in Systems Manager Parameter Store.  (This was before Secrets Manager was a thing.)  These secrets are locked down and can only be accessed by the root account.  I recommend storing the `readonly` account credentials in LastPass and only using that unless you're really really sure.

The database is in a VPC and not directly accessible through the internet.  There is a bastion host (aka jump box) that can only be reached from the office IP that can establish an SSH tunnel to the database.

1. If you're connecting to staging or production change `STACK_NAME` at the top of `dev.sh` to `staging-Rothschild` or `production-Rothschild` respectively.
2. `./dev.sh rdstunnel`
3. In your SQL client (like MySQL Workbench) connect to hostname "localhost" port "3306".  Username and password will depend upon the credentials.

If `/Volumes/credentials/ssh/AWSKey.pem` does not exist:

1. `ssh-keygen -t rsa -b 4096 -C "AWSKey" -f /Volumes/credentials/ssh/AWSKey.pem`
2. `aws iam upload-ssh-public-key --user-name <your aws user name> --ssh-public-key-body file:///Volumes/credentials/ssh/AWSKey.pem.pub`

## Example SQL

What follows is some example queries that you may be asked to run against the DB some day.

As stated above where you see `userId` understand that that *is* the ID of the Account.

### Get accountIds that have live mode Transactions between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT userId
FROM Transactions
WHERE userId NOT LIKE '%-TEST'
    AND createdDate >= @dateStart
    AND createdDate < @dateEnd
GROUP BY userId
```

### Get accountIds that don't have live mode Transactions between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT userId
FROM Currencies
WHERE userId NOT LIKE '%-TEST'
    AND NOT EXISTS (
        SELECT userId as u
        FROM Transactions
        WHERE Transactions.userId = Currencies.userId
            AND createdDate >= @dateStart
            AND createdDate < @dateEnd
    )
GROUP BY userId
```

### Get accountIds that did have live mode Transactions between two dates, but have not since

```sql
SET @dateStart = '2020-01-01';
SET @dateEnd = '2020-10-01';
SELECT userId
FROM (
	SELECT userId
	FROM Transactions
	WHERE userId NOT LIKE '%-TEST'
		AND createdDate >= @dateStart
		AND createdDate < @dateEnd
	GROUP BY userId
) as ActiveUsers
WHERE NOT EXISTS (
	SELECT userId
    FROM Transactions
    WHERE Transactions.userId = ActiveUsers.userId
		AND createdDate >= @dateEnd
)
```

### Count the number of live mode Values created between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT COUNT(*)
FROM `Values`
WHERE createdDate >= @dateStart
    AND createdDate < @dateEnd
    AND NOT userId LIKE '%_TEST'
```

### Count the number of live mode Contacts created between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT COUNT(*)
FROM `Contacts`
WHERE createdDate >= @dateStart
    AND createdDate < @dateEnd
    AND userId NOT LIKE '%_TEST'
```

### Get the live mode currencies used on Lightrail between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT currency
FROM `Transactions`
WHERE createdDate >= @dateStart
    AND createdDate < @dateEnd
    AND userId NOT LIKE '%_TEST'
GROUP BY currency
```

### Count the number of live mode Transactions by each customer between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT userId, COUNT(*) as txcount
FROM `Transactions`
WHERE createdDate >= @dateStart
    AND createdDate < @dateEnd
    AND userId NOT LIKE '%-TEST'
GROUP BY userId
ORDER BY txcount DESC
```

### Sum the USD amount processed by Stripe and Lightrail between two dates

```sql
SET @dateStart = '2020-10-01';
SET @dateEnd = '2020-11-01';
SELECT sum(totals_paidStripe / power(10, Currencies.decimalPlaces)) as paidStripe,
    sum(totals_paidLightrail / power(10, Currencies.decimalPlaces)) as paidLightrail,
    sum(totals_discountLightrail / power(10, Currencies.decimalPlaces)) as discountLightrail,
    sum(totals_remainder / power(10, Currencies.decimalPlaces)) as remainder
FROM `Transactions`
JOIN `Currencies` ON Transactions.currency = Currencies.code
    AND Transactions.userId = Currencies.userId
WHERE Currencies.code = 'USD'
    AND Transactions.createdDate >= @dateStart
    AND Transactions.createdDate < @dateEnd
    AND Transactions.userId NOT LIKE '%_TEST'
```
