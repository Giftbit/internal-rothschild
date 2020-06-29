import * as superagent from "superagent";

export async function kvsDelete(token: string, key: string): Promise<void> {
    try {
        await superagent.delete(`https://${getLightrailDomain()}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Content-Type", "application/json")
            .timeout({
                // When things are healthy our P99 latency is between 2 and 4 seconds.
                response: 4000,
                deadline: 6000
            })
            .retry(3);  // Delete is idempotent so retry is ok.
    } catch (err) {
        if (err.timeout) {
            err.message = `Timeout on KVS delete: ${err.message}`;
        }
        throw err;
    }
}

export async function kvsGet(token: string, key: string, authorizeAs?: string): Promise<any> {
    try {
        const request = superagent.get(`https://${getLightrailDomain()}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .ok(r => r.ok || r.status === 404)
            .timeout({
                // When things are healthy our P99 latency is between 2 and 4 seconds.
                response: 4000,
                deadline: 6000
            })
            .retry(3);
        if (authorizeAs) {
            request.set("AuthorizeAs", authorizeAs);
        }
        const resp = await request.query({});
        if (resp.ok) {
            return resp.body;
        }
        return null;
    } catch (err) {
        if (err.timeout) {
            err.message = `Timeout on KVS get: ${err.message}`;
        }
        throw err;
    }
}

export async function kvsPut(token: string, key: string, value: any): Promise<void> {
    try {
        await superagent.put(`https://${getLightrailDomain()}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Content-Type", "application/json")
            .send(value)
            .timeout({
                // When things are healthy our P99 latency is between 2 and 4 seconds.
                response: 4000,
                deadline: 6000
            })
            .retry(3);  // Put is idempotent so retry is ok.
    } catch (err) {
        if (err.timeout) {
            err.message = `Timeout on KVS put: ${err.message}`;
        }
        throw err;
    }
}

function getLightrailDomain(): string {
    if (!process.env["LIGHTRAIL_DOMAIN"]) {
        throw new Error("Env var LIGHTRAIL_DOMAIN undefined.");
    }
    return process.env["LIGHTRAIL_DOMAIN"];
}
