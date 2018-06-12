import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as childProcess from "child_process";
import * as mysql from "mysql2/promise";
import * as path from "path";
import {sendCloudFormationResponse} from "../../sendCloudFormationResponse";
import {getDbCredentials} from "../../dbUtils/connection";

// Every SQL migration file needs to be named here to be included in the dist.
// Files must be named V#__migration_name.sql where # is the next number sequentially.
require("./schema/V1__base.sql");

// Flyway version to download and use.  Flyway does the migration.
const flywayVersion = "5.0.7";

// Remove this ability after firmly establishing V1.
const dropExistingDb = false;

/**
 * Handles a CloudFormationEvent and upgrades the database.
 */
export async function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, callback: awslambda.Callback): Promise<any> {
    console.log("event", JSON.stringify(evt, null, 2));

    if (evt.RequestType === "Delete") {
        console.log("This action cannot be rolled back.  Calling success without doing anything.");
        return sendCloudFormationResponse(evt, ctx, true, {});
    }

    try {
        const res = await migrateDatabase(ctx);
        return sendCloudFormationResponse(evt, ctx, true, res);
    } catch (err) {
        console.error(JSON.stringify(err, null, 2));
        return sendCloudFormationResponse(evt, ctx, false, null, err.message);
    }
}

async function migrateDatabase(ctx: awslambda.Context): Promise<any> {
    console.log("downloading flyway", flywayVersion);
    await spawn("curl", ["-o", `/tmp/flyway-commandline-${flywayVersion}.tar.gz`, `https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${flywayVersion}/flyway-commandline-${flywayVersion}.tar.gz`]);

    console.log("extracting flyway");
    await spawn("tar", ["-xf", `/tmp/flyway-commandline-${flywayVersion}.tar.gz`, "-C", "/tmp"]);

    console.log("waiting for database to be connectable");
    const conn = await getConnection(ctx);
    if (dropExistingDb) {
        const [schemaRes] = await conn.query("SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?", ["rothschild"]);
        if (schemaRes.length > 0) {
            console.log("dropping existing schema");
            const [dropRes] = await conn.execute("DROP DATABASE rothschild;");
            console.log("dropRes=", dropRes);
        }
    }
    conn.end();

    console.log("invoking flyway");
    const credentials = await getDbCredentials();
    await spawn(`/tmp/flyway-${flywayVersion}/flyway`, ["-X", "migrate"], {
        env: {
            FLYWAY_USER: credentials.username,
            FLYWAY_PASSWORD: credentials.password,
            FLYWAY_DRIVER: "com.mysql.jdbc.Driver",
            FLYWAY_URL: `jdbc:mysql://${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}/`,
            FLYWAY_LOCATIONS: `filesystem:${path.resolve(".", "schema")}`,
            FLYWAY_SCHEMAS: "rothschild"
        }
    });
}

function spawn(cmd: string, args?: string[], options?: childProcess.SpawnOptions): Promise<{stdout: string[], stderr: string[]}> {
    const child = childProcess.spawn(cmd, args, options);

    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", data => stdout.push(data.toString()));
    child.stderr.on("data", data => stderr.push(data.toString()));
    return new Promise<{stdout: string[], stderr: string[]}>((resolve, reject) => {
        child.on("error", error => {
            console.error("Error running", cmd, args.join(" "));
            console.error(error);
            stdout.length && console.log("stdout:", stdout.join(""));
            stderr.length && console.log("stderr:", stderr.join(""));
            reject(error);
        });
        child.on("close", code => {
            console.log(cmd, args.join(" "));
            stdout.length && console.log("stdout:", stdout.join(""));
            stderr.length && console.log("stderr:", stderr.join(""));
            resolve({stdout, stderr});
        });
    });
}

async function getConnection(ctx: awslambda.Context): Promise<mysql.Connection> {
    const credentials = await getDbCredentials();

    while (true) {
        try {
            console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
            return await mysql.createConnection({
                host: process.env["DB_ENDPOINT"],
                port: +process.env["DB_PORT"],
                user: credentials.username,
                password: credentials.password,
                timezone: "Z"
            });
        } catch (err) {
            console.log("error connecting to database", err);
            if (err.code && (err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") && ctx.getRemainingTimeInMillis() > 60000) {
                console.log("retrying...");
            } else {
                throw err;
            }
        }
    }
}
