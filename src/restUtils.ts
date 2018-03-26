import * as cassava from "cassava";
import * as jsonschema from "jsonschema";

let validator: jsonschema.Validator;

export function validateBody(evt: cassava.RouterEvent, schema: jsonschema.Schema): void {
    if (!validator) {
        validator = new jsonschema.Validator();
    }

    const result = validator.validate(evt.body, schema);
    if (result.errors.length) {
        throw new cassava.RestError(
            cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY,
            `The ${evt.httpMethod} body has ${result.errors.length} validation error(s): ${result.errors.map(e => e.toString()).join(", ")}.`
        );
    }
}
