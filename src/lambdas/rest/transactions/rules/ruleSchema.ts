import * as jsonschema from "jsonschema";

export const ruleSchema: jsonschema.Schema = {
    title: "Rule",
    type: ["null", "object"],
    properties: {
        rule: {
            type: "string"
        },
        explanation: {
            type: "string"
        }
    },
    required: ["rule", "explanation"],
    additionalProperties: false
};