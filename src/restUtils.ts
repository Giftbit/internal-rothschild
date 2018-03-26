import * as cassava from "cassava";
import * as jsonschema from "jsonschema";

let bodyValidator: jsonschema.Validator;

export function validateBody(evt: cassava.RouterEvent, schema: jsonschema.Schema): void {
    if (!bodyValidator) {
        bodyValidator = new jsonschema.Validator();
    }
    
    const bodyValidatorResult = bodyValidator.validate(evt.body, schema);
    if (bodyValidatorResult.errors.length) {
        // TODO massage this into a rest error
        throw new Error(JSON.stringify(bodyValidatorResult));
    }
}
