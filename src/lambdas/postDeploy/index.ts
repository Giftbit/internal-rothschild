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
import log = require("loglevel");

log.setLevel(log.levels.DEBUG);

// Flyway version to download and use.  Flyway does the migration.
const flywayVersion = "5.0.7";

/**
 * Handles a CloudFormationEvent and upgrades the database.
 */
export async function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<any> {
    console.log("IS THIS HAPPENING LOCALLY?");
    if (evt.RequestType === "Delete") {
        log.info("This action cannot be rolled back.  Calling success without doing anything.");
        return sendCloudFormationResponse(evt, ctx, true, {});
    }
    if (!evt.ResourceProperties.ReadOnlyUserPassword) {
        throw new Error("ResourceProperties.ReadOnlyUserPassword is undefined");
    }

    try {
        const res = await migrateDatabase(ctx, evt.ResourceProperties.ReadOnlyUserPassword);
        return sendCloudFormationResponse(evt, ctx, true, res);
    } catch (err) {
        log.error(JSON.stringify(err, null, 2));
        return sendCloudFormationResponse(evt, ctx, false, null, err.message);
    }
}

async function migrateDatabase(ctx: awslambda.Context, readonlyUserPassword: string): Promise<any> {
    console.log("IS THIS HAPPENING LOCALLY?");
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
