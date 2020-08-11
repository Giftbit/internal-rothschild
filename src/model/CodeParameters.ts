import {GenerateCodeParameters} from "./GenerateCodeParameters";

export interface CodeParameters {
    isGenericCode: boolean;
    generateCode: GenerateCodeParameters;
    code: string;
}
