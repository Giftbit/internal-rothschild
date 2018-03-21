import * as aws from "aws-sdk";

export async function getDbCredentials(): Promise<{username: string, password: string}> {
    if (!process.env["DB_USERNAME_PARAMETER"]) {
        throw new Error("env var DB_USERNAME_PARAMETER not set");
    }
    if (!process.env["DB_PASSWORD_PARAMETER"]) {
        throw new Error("env var DB_PASSWORD_PARAMETER not set");
    }

    const ssm = new aws.SSM({
        apiVersion: "2014-11-06",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    console.log("fetching db parameters");
    const resp = await ssm.getParameters({
        Names: [process.env["DB_USERNAME_PARAMETER"], process.env["DB_PASSWORD_PARAMETER"]],
        WithDecryption: true
    }).promise();

    if (resp.InvalidParameters && resp.InvalidParameters.length) {
        throw new Error(`Invalid parameters requested: ${resp.InvalidParameters.join(", ")}`);
    }

    return {
        username: resp.Parameters.find(p => p.Name === process.env["DB_USERNAME_PARAMETER"]).Value,
        password: resp.Parameters.find(p => p.Name === process.env["DB_PASSWORD_PARAMETER"]).Value
    };
}
