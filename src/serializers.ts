import papaparse = require("papaparse");

export function csvSerializer(body: any): string {
    if (body instanceof Array) {
        for (let obj of body) {
            obj = stringifyChildObjects(obj);
        }
    } else if (body instanceof Object) {
        body = stringifyChildObjects(body);
    }
    const result = papaparse.unparse(body);
    console.log(result);
    return result;
}

function stringifyChildObjects(object: any): any {
    if (object instanceof Object) {
        for (const key of Object.keys(object)) {
            if (object[key] instanceof Object && object[key].toString() === "[object Object]") {
                object[key] = JSON.stringify(object[key]);
            }
        }
        return object;
    } else {
        return object
    }
}