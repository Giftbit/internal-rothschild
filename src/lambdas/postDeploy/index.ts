import * as awslambda from "aws-lambda";
import * as childProcess from "child_process";
import * as mysql from "mysql2/promise";
import * as path from "path";
import {sendCloudFormationResponse} from "../../sendCloudFormationResponse";
import {getDbCredentials} from "../../utils/dbUtils/connection";
// Expands to an import of all files matching the glob using the import-glob-loader.
// Copies the .sql files into the schema dir using the file-loader.
// Flyway will automatically load all .sql files it finds in that dir.
import "./schema/*.sql";
import {
    getLightrailStripeModeConfig,
    initializeAssumeCheckoutToken,
    initializeLightrailStripeConfig
} from "../../utils/stripeUtils/stripeAccess";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {StripeConfig} from "../../utils/stripeUtils/StripeConfig";
import log = require("loglevel");

// Wrapping console.log instead of binding (default behaviour for loglevel)
// Otherwise all log calls are prefixed with the requestId from the first
// request the lambda received (AWS modifies log calls, loglevel binds to the
// version of console.log that exists when it is initialized).
// See https://github.com/pimterry/loglevel/blob/master/lib/loglevel.js
// tslint:disable-next-line:no-console
log.methodFactory = () => (...args) => console.log(...args);

log.setLevel(log.levels.DEBUG);

// Flyway version to download and use.  Flyway does the migration.
const flywayVersion = "5.0.7";

/**
 * Handles a CloudFormationEvent and upgrades the database.
 */
export async function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<any> {
    if (evt.RequestType === "Delete") {
        log.info("This action cannot be rolled back.  Calling success without doing anything.");
        return sendCloudFormationResponse(evt, ctx, true, {});
    }
    if (!evt.ResourceProperties.ReadOnlyUserPassword) {
        throw new Error("ResourceProperties.ReadOnlyUserPassword is undefined");
    }

    try {
        await setStripeWebhookEvents(evt);
        const res = await migrateDatabase(ctx, evt.ResourceProperties.ReadOnlyUserPassword);
        return sendCloudFormationResponse(evt, ctx, true, res);
    } catch (err) {
        log.error(JSON.stringify(err, null, 2));
        return sendCloudFormationResponse(evt, ctx, false, null, err.message);
    }
}

async function migrateDatabase(ctx: awslambda.Context, readonlyUserPassword: string): Promise<any> {
    log.info("downloading flyway", flywayVersion);
    await spawn("curl", ["-o", `/tmp/flyway-commandline-${flywayVersion}.tar.gz`, `https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${flywayVersion}/flyway-commandline-${flywayVersion}.tar.gz`]);

    log.info("extracting flyway");
    await spawn("tar", ["-xf", `/tmp/flyway-commandline-${flywayVersion}.tar.gz`, "-C", "/tmp"]);

    log.info("waiting for database to be connectable");
    const conn = await getConnection(ctx);
    conn.end();

    log.info("invoking flyway");
    const credentials = await getDbCredentials();
    try {
        await spawn(`/tmp/flyway-${flywayVersion}/flyway`, ["-X", "migrate"], {
            env: {
                FLYWAY_USER: credentials.username,
                FLYWAY_PASSWORD: credentials.password,
                FLYWAY_DRIVER: "com.mysql.jdbc.Driver",
                FLYWAY_URL: `jdbc:mysql://${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}/`,
                FLYWAY_LOCATIONS: `filesystem:${path.resolve(".", "schema")}`,
                FLYWAY_SCHEMAS: "rothschild",
                FLYWAY_PLACEHOLDERS_READONLYUSERPASSWORD: readonlyUserPassword // Flyway makes this accessible via ${readonlyuserpassword} in mysql files.
            }
        });
    } catch (err) {
        log.error("error performing flyway migrate, attempting to fetch schema history table");
        await logFlywaySchemaHistory(ctx);
        throw err;
    }
}

function spawn(cmd: string, args?: string[], options?: childProcess.SpawnOptions): Promise<{ stdout: string[], stderr: string[] }> {
    const child = childProcess.spawn(cmd, args, options);

    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", data => stdout.push(data.toString()));
    child.stderr.on("data", data => stderr.push(data.toString()));
    return new Promise<{ stdout: string[], stderr: string[] }>((resolve, reject) => {
        child.on("error", error => {
            log.error("Error running", cmd, args.join(" "));
            log.error(error);
            stdout.length && log.info("stdout:", stdout.join(""));
            stderr.length && log.error("stderr:", stderr.join(""));
            reject(error);
        });
        child.on("close", code => {
            log.info(cmd, args.join(" "));
            stdout.length && log.info("stdout:", stdout.join(""));
            stderr.length && log.error("stderr:", stderr.join(""));
            code === 0 ? resolve({
                stdout,
                stderr
            }) : reject(new Error("Flyways database migration failed.  Look at the logs for details."));
        });
    });
}

async function getConnection(ctx: awslambda.Context): Promise<mysql.Connection> {
    const credentials = await getDbCredentials();

    while (true) {
        try {
            log.info(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
            return await mysql.createConnection({
                host: process.env["DB_ENDPOINT"],
                port: +process.env["DB_PORT"],
                user: credentials.username,
                password: credentials.password,
                timezone: "Z"
            });
        } catch (err) {
            log.error("error connecting to database", err);
            if (err.code && (err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") && ctx.getRemainingTimeInMillis() > 60000) {
                log.info("retrying...");
            } else {
                throw err;
            }
        }
    }
}

async function logFlywaySchemaHistory(ctx: awslambda.Context): Promise<void> {
    const connection = await getConnection(ctx);
    const res = await connection.query(
        "SELECT * FROM rothschild.flyway_schema_history"
    );
    log.info("flyway schema history:\n", JSON.stringify(res[0]));
}

async function setStripeWebhookEvents(event: awslambda.CloudFormationCustomResourceEvent): Promise<void> {
    try {
        initializeAssumeCheckoutToken(
            giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH")
        );
        initializeLightrailStripeConfig(
            giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE")
        );
    } catch (err) {
        log.error(`Error fetching Stripe credentials from secure config: enabled Stripe webhook events have not been updated. Secure config permissions may need to be set. \nError: ${JSON.stringify(err, null, 2)}`);
        return; // don't fail deployment if the function can't get the Stripe credentials (stack should be deployable in a new environment where function role name isn't known and can't have had permissions set)
    }

    // set of events that should be enabled is a variable passed in on the event (defined in sam.yaml)
    const webhookEventsToEnable = event.ResourceProperties.StripeWebhookEvents;
    const url = buildStripeWebhookHandlerEndpoint(process.env["LIGHTRAIL_DOMAIN"]);

    // fetch existing webhooks
    const lightrailStripe = require("stripe")((await getLightrailStripeModeConfig(false)).secretKey);
    const webhooks = await lightrailStripe.webhookEndpoints.list();

    // if an existing webhook is already configured with the right url, update it; otherwise create it (should only happen on first deploy)
    if (webhooks.data.find(w => w.url === url)) {
        await lightrailStripe.webhookEndpoints.update(webhooks.data.find(w => w.url === url).id, {
            enabled_events: webhookEventsToEnable,
        });
    } else {
        await lightrailStripe.webhookEndpoints.create({
            url,
            enabled_events: webhookEventsToEnable,
            connect: true
        });
    }
}

function buildStripeWebhookHandlerEndpoint(lightrailDomain: string): string {
    return `https://${lightrailDomain}/v2/stripeEventWebhook`;
}
