// Function definitions copied from internal-turnkey. Added to exports to facilitate testing.

import * as superagent from "superagent";

const timeoutMs = 15000;

export async function kvsDelete(token: string, key: string): Promise<void> {
    try {
        await superagent.delete(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Content-Type", "application/json")
            .timeout(timeoutMs);
    } catch (err) {
        if (err.timeout) {
            err.message = `Timeout on KVS delete: ${err.message}`;
        }
        throw err;
    }
}

export async function kvsGet(token: string, key: string, authorizeAs?: string): Promise<any> {
    try {
        let request = superagent.get(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .ok(r => r.ok || r.status === 404)
            .timeout(timeoutMs);
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
        await superagent.put(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Content-Type", "application/json")
            .send(value)
            .timeout(timeoutMs);
    } catch (err) {
        if (err.timeout) {
            err.message = `Timeout on KVS put: ${err.message}`;
        }
        throw err;
    }
}
