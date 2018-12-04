import {RuleFunction} from "giftbit-ruleslib/distjs/functions/RuleFunction";
import {ExpressionNode} from "giftbit-ruleslib/distjs/ast/ExpressionNode";
import {Context} from "giftbit-ruleslib/distjs/Context";
import {Value} from "giftbit-ruleslib/distjs/Value";

// unused but currently left in code since it'll likely be added shortly.
export class Amount extends RuleFunction {
    invoke(args: ExpressionNode[], context: Context): Value {
        return this.resolveFirstAsNumber(args, context) + context["values"]["value"]["balanceChange"];
    }
}