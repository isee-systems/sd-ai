import projectUtils from '../../utilities/utils.js'
import { LLMWrapper } from '../../utilities/LLMWrapper.js'
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class QuantitativeEngineBrain {

    static MODULE_REQUIREMENTS_SECTION =
`CRITICAL MODULAR MODEL REQUIREMENTS:

WHEN TO USE MODULES:
- DO NOT create modules unless the model already uses modules OR the user explicitly requests modular structure
- If the existing model has NO modules, build a NON-MODULAR model
- If the existing model HAS modules, maintain and extend the modular structure
- Only introduce modules when specifically asked by the user

WHEN USING MODULES - GHOST VARIABLE REQUIREMENTS:
When constructing modular models, you MUST create cross-level ghost variables for ALL inter-module references:
1. Create the source variable in its computation module
2. Create a cross-level ghost variable in EVERY consuming module that references the source variable
3. The ghost variable MUST have an identical local name as the source variable
4. Mark the ghost variable explicitly as: crossLevelGhostOf = <sourceVariable>
5. Ghost variables have NO equation - they reference their source variable only
6. ALL equations in the consuming module MUST reference the cross-level ghost variable, NOT the original source variable

FAILURE TO CREATE AND LINK GHOST VARIABLES WILL BREAK SIMULATION. This is non-negotiable.
REFERENCING THE ORIGINAL SOURCE VARIABLE DIRECTLY FROM A CONSUMING MODULE WILL BREAK SIMULATION. Always use the ghost.`

    static ARRAY_REQUIREMENTS_SECTION =
`CRITICAL ARRAY REQUIREMENTS:

WHEN TO USE ARRAYS:
- DO NOT create arrays or array dimensions unless the model already uses arrays OR the user explicitly requests arrayed variables
- If the existing model has NO arrays, build a NON-ARRAYED model with scalar variables only
- If the existing model HAS arrays, maintain and extend the array structure consistently
- Only introduce arrays when specifically asked by the user
- Arrays add significant complexity - use them ONLY when necessary

WHEN USING ARRAYS - DIMENSION AND EQUATION REQUIREMENTS:
When constructing models with arrayed variables, you MUST follow these rules:
1. ALL array dimensions MUST be defined in the specs.arrayDimensions list before being referenced
2. Each dimension MUST have a unique name (singular, alphanumeric only)
3. For label dimensions: specify element names; for numeric dimensions: specify size
4. Variables reference dimensions by name in their dimensions array (order matters)
5. NEVER remove dimensions from existing arrayed variables unless explicitly directed to do so by the end user
6. Arrayed variables MUST have equations for ALL element combinations:
   - If all elements use the SAME formula: provide ONE equation in the 'equation' field
   - If elements differ: provide element-specific equations in the 'arrayEquations' array (NOT 'equation')
   - For arrayed STOCKS: you MUST provide initial values for each element using 'arrayEquations'
   - NEVER leave the 'equation' or 'arrayEquations' fields empty for any variable
7. Array element references in 'forElements' use individual dimension element names (e.g., ["North", "Q1"])
8. SUM function syntax - CRITICAL:
   - ALWAYS use asterisk (*) to represent the dimension being summed - NEVER use the dimension name
   - MANDATORY: Every SUM equation MUST contain at least one asterisk (*) - without it, the SUM is invalid
   - WRONG: SUM(Revenue[region]) or SUM(Sales[product])
   - CORRECT: SUM(Revenue[*]) to sum across all elements of a single dimension
   - CORRECT: SUM(Sales[product,*]) to sum across the second dimension of a 2D array
   - The asterisk (*) is a wildcard that means "sum over all elements of this dimension"

FAILURE TO PROPERLY DEFINE DIMENSIONS AND EQUATIONS WILL BREAK SIMULATION. This is non-negotiable.`

    static MANDATORY_PROCESS_SECTION =
`MANDATORY PROCESS - Execute these steps in order:

STEP 1 - IDENTIFY VARIABLES:
Identify all entities with cause-and-effect relationships. Name variables using these rules:
- Maximum 5 words per name
- Minimize total variable count
- Use neutral terminology (no positive/negative connotations)
- Use ONLY letters and spaces (NO symbols, NO dashes, NO arthemtic operators and NO punctuation)

STEP 2 - DEFINE CAUSAL RELATIONSHIPS:
Assign polarity to each causal relationship:
- Positive polarity (+): Variables move together (both increase OR both decrease)
  Example 1: Decrease in cause → decrease in effect = POSITIVE (+)
  Example 2: Increase in cause → increase in effect = POSITIVE (+)
- Negative polarity (-): Variables move opposite (anticorrelated)
  Example 1: Decrease in cause → increase in effect = NEGATIVE (-)
  Example 2: Increase in cause → decrease in effect = NEGATIVE (-)

STEP 3 - DETERMINE VARIABLE TYPES:
Classify each variable as one of three types:
- STOCK: Accumulations that change ONLY via their flows
- FLOW: Derivatives that change stocks (rate of change)
- VARIABLE: Auxiliary variables for algebraic expressions

STEP 4 - WRITE EQUATIONS:
Provide equations for every variable:
- Write all equations in XMILE format
- CONSTANT HANDLING: NEVER embed numerical constants directly in equations with other variables. ALWAYS create separate named variables for all constants.
- Every variable referenced in an equation MUST have its own equation, type, and appear in the relationships list
- GRAPHICAL FUNCTION BEST PRACTICES:
  * For all non-time based graphical functions: Design the function so that normal input produces normal output and include the point (1, 1) in your graphical function to ensure that when the input variable equals 1, the output equals 1
  * This normalization principle allows the function to express deviations from normal behavior in both directions
  * Example: A "productivity multiplier from experience" function should pass through (1, 1) so that normal experience (input=1) yields normal productivity (output=1)
  * Time-based graphical functions (using TIME as input) do NOT need to follow this normalization rule`

    static ARRAY_SPECIFIC_EQUATION_REQUIREMENTS =
`CRITICAL EQUATION REQUIREMENT: Every variable MUST have EITHER 'equation' OR 'arrayEquations' populated (never both, never neither)
  * For SCALAR (non-arrayed) variables: ALWAYS provide 'equation'
ARRAY-SPECIFIC EQUATION REQUIREMENTS:
- For ARRAYED variables where all elements use the SAME formula: provide 'equation' only
- For ARRAYED variables where elements have DIFFERENT formulas: provide 'arrayEquations' with entries for ALL elements (omit 'equation')
- For arrayed STOCKS with numeric initialization: ALWAYS use 'arrayEquations' to specify initial values for each element individually (omit 'equation')
- SUM FUNCTION SYNTAX FOR ARRAYS:
  * ALWAYS use asterisk (*) for the dimension to sum, NEVER the dimension name
  * CRITICAL: Every SUM equation MUST contain at least one asterisk (*) - this is mandatory
  * WRONG: SUM(Revenue[region]) or SUM(Sales[product])
  * CORRECT: SUM(Revenue[*]) to sum across all elements of a single dimension
  * CORRECT: SUM(Sales[product,*]) to sum across the second dimension of a 2D array
  * The asterisk (*) represents "sum over all elements of this dimension"`

    static VERIFY_MODEL_SECTION =
`STEP 5 - VERIFY MODEL VALIDITY:
Continuously verify the model produces correct results for correct reasons. Question whether the structure truly represents the described system.`

    
    static ARRAY_EXAMPLE =
`EXAMPLE - COMPLETE ARRAY MODEL:
Here is a complete example of a properly structured array model with two dimensions (Product and Location):

{
    "specs": {
        "arrayDimensions": [
            {
                "elements": ["BGO", "NYC"],
                "name": "Location",
                "type": "label"
            },
            {
                "elements": ["Pizza", "Kebab", "Sandwich"],
                "name": "Product",
                "type": "label"
            }
        ],
        "dt": 0.25,
        "startTime": 1,
        "stopTime": 13,
        "timeUnits": "Month"
    },
    "variables": [
        {
            "name": "price",
            "type": "variable",
            "dimensions": ["Product", "Location"],
            "equation": "IF Product = Product.Pizza THEN 250 ELSE IF Product = Product.Kebab THEN 150 ELSE 125",
            "units": "Nok/Product"
        },
        {
            "name": "sales",
            "type": "variable",
            "dimensions": ["Product", "Location"],
            "arrayEquations": [
                { "forElements": ["Pizza", "BGO"], "equation": "1000" },
                { "forElements": ["Pizza", "NYC"], "equation": "2000" },
                { "forElements": ["Kebab", "BGO"], "equation": "2000" },
                { "forElements": ["Kebab", "NYC"], "equation": "800" },
                { "forElements": ["Sandwich", "BGO"], "equation": "1500" },
                { "forElements": ["Sandwich", "NYC"], "equation": "1500" }
            ],
            "units": "Product/Month"
        },
        {
            "name": "revenue",
            "type": "variable",
            "dimensions": ["Product", "Location"],
            "equation": "price*sales",
            "units": "Nok/Months"
        },
        {
            "name": "total revenue",
            "type": "variable",
            "equation": "SUM(revenue)",
            "units": "Nok/Months"
        },
        {
            "name": "revenue by product",
            "type": "variable",
            "dimensions": ["Product"],
            "equation": "SUM(revenue[Product,*])",
            "units": "Nok/Months"
        },
        {
            "name": "revenue by location",
            "type": "variable",
            "dimensions": ["Location"],
            "equation": "SUM(revenue[*, Location])",
            "units": "Nok/Months"
        }
    ],
    "relationships": [
        { "from": "price", "to": "revenue", "polarity": "+" },
        { "from": "sales", "to": "revenue", "polarity": "+" },
        { "from": "revenue", "to": "total revenue", "polarity": "+" },
        { "from": "revenue", "to": "revenue by product", "polarity": "+" },
        { "from": "revenue", "to": "revenue by location", "polarity": "+" }
    ]
}

Key lessons from this example:
- Dimensions are defined first in specs.arrayDimensions with all elements listed
- Variables with same formula for all elements use 'equation' field (e.g., price, revenue)
- Variables with different values per element use 'arrayEquations' (e.g., sales)
- SUM(revenue) sums across ALL dimensions to produce a scalar
- SUM(revenue[Product,*]) sums across second dimension, preserving first dimension
- SUM(revenue[*, Location]) sums across first dimension, preserving second dimension
- The asterisk (*) indicates which dimension to sum over`

    static MODULE_EXAMPLE =
`EXAMPLE - COMPLETE MODULAR MODEL WITH GHOST VARIABLES:
Here is a complete example of a properly structured modular model (Lynx-Hare predator-prey system):

{
    "specs": {
        "arrayDimensions": [],
        "dt": 0.03125,
        "startTime": 0,
        "stopTime": 100,
        "timeUnits": "year"
    },
    "variables": [
        {
            "name": "Hares.area",
            "type": "variable",
            "equation": "1E3",
            "units": "arce"
        },
        {
            "name": "Hares.Hares",
            "type": "stock",
            "equation": "5E4",
            "inflows": ["Hares.hare births"],
            "outflows": ["Hares.hare deaths"],
            "units": "hares"
        },
        {
            "name": "Hares.hare births",
            "type": "flow",
            "equation": "Hares*hare_birth_fraction",
            "units": "hares/year"
        },
        {
            "name": "Hares.hare deaths",
            "type": "flow",
            "equation": "Lynx*hares_killed_per_lynx",
            "units": "hares/year"
        },
        {
            "name": "Hares.hare birth fraction",
            "type": "variable",
            "equation": "1.25",
            "units": "per year"
        },
        {
            "name": "Hares.hare density",
            "type": "variable",
            "equation": "Hares/area",
            "units": "hares/arce"
        },
        {
            "name": "Hares.hares killed per lynx",
            "type": "variable",
            "equation": "hare_density",
            "units": "hares/lynx/year",
            "graphicalFunction": [
                { "x": 0, "y": 0 },
                { "x": 50, "y": 50 },
                { "x": 100, "y": 100 },
                { "x": 150, "y": 150 },
                { "x": 200, "y": 200 },
                { "x": 250, "y": 250 },
                { "x": 300, "y": 300 },
                { "x": 350, "y": 350 },
                { "x": 400, "y": 400 },
                { "x": 450, "y": 450 },
                { "x": 500, "y": 500 }
            ]
        },
        {
            "name": "Hares.Lynx",
            "type": "variable",
            "crossLevelGhostOf": "Lynx.Lynx",
            "equation": "",
            "units": "lynx"
        },
        {
            "name": "Lynx.Lynx",
            "type": "stock",
            "equation": "1250",
            "inflows": ["Lynx.lynx births"],
            "outflows": ["Lynx.lynx deaths"],
            "units": "lynx"
        },
        {
            "name": "Lynx.lynx births",
            "type": "flow",
            "equation": "Lynx*lynx_birth_fraction",
            "units": "lynx/year"
        },
        {
            "name": "Lynx.lynx deaths",
            "type": "flow",
            "equation": "Lynx*lynx_death_fraction",
            "units": "lynx/year"
        },
        {
            "name": "Lynx.lynx birth fraction",
            "type": "variable",
            "equation": ".25",
            "units": "per year"
        },
        {
            "name": "Lynx.lynx death fraction",
            "type": "variable",
            "equation": "hare_density",
            "units": "per year",
            "graphicalFunction": [
                { "x": 0, "y": 0.94 },
                { "x": 10, "y": 0.66 },
                { "x": 20, "y": 0.4 },
                { "x": 30, "y": 0.35 },
                { "x": 40, "y": 0.3 },
                { "x": 50, "y": 0.25 },
                { "x": 60, "y": 0.2 },
                { "x": 70, "y": 0.15 },
                { "x": 80, "y": 0.1 },
                { "x": 90, "y": 0.07 },
                { "x": 100, "y": 0.05 }
            ]
        },
        {
            "name": "Lynx.hare density",
            "type": "variable",
            "crossLevelGhostOf": "Hares.hare density",
            "equation": "",
            "units": "hares/arce"
        }
    ],
    "relationships": [
        { "from": "Hares.Hares", "to": "Hares.hare births" },
        { "from": "Hares.hare birth fraction", "to": "Hares.hare births" },
        { "from": "Hares.Hares", "to": "Hares.hare density" },
        { "from": "Hares.hare density", "to": "Hares.hares killed per lynx" },
        { "from": "Hares.hares killed per lynx", "to": "Hares.hare deaths" },
        { "from": "Hares.area", "to": "Hares.hare density" },
        { "from": "Hares.hare births", "to": "Hares.Hares", "polarity": "+" },
        { "from": "Hares.hare deaths", "to": "Hares.Hares", "polarity": "-" },
        { "from": "Hares.Lynx", "to": "Hares.hare deaths" },
        { "from": "Lynx.Lynx", "to": "Lynx.lynx births" },
        { "from": "Lynx.lynx birth fraction", "to": "Lynx.lynx births" },
        { "from": "Lynx.Lynx", "to": "Lynx.lynx deaths" },
        { "from": "Lynx.lynx death fraction", "to": "Lynx.lynx deaths" },
        { "from": "Lynx.lynx births", "to": "Lynx.Lynx", "polarity": "+" },
        { "from": "Lynx.lynx deaths", "to": "Lynx.Lynx", "polarity": "-" },
        { "from": "Lynx.hare density", "to": "Lynx.lynx death fraction" }
    ]
}

Key lessons from this modular example:
- Module names use dot notation: "ModuleName.variableName"
- Cross-level ghost variables are created for inter-module references
- Ghost variable "Hares.Lynx" references source "Lynx.Lynx" (allows Hares module to use Lynx population)
- Ghost variable "Lynx.hare density" references source "Hares.hare density" (allows Lynx module to use hare density)
- Ghost variables have crossLevelGhostOf set to the source variable's full name
- Ghost variables have empty equation field (equation = "")
- All equations in a module reference the ghost variable, NOT the original source variable
- This creates proper module encapsulation while allowing cross-module dependencies`

    static FORMULATION_ERROR_SECTION =
`IDENTIFY FORMULATION ERRORS:
When reviewing or fixing models, detect and correct these common errors:

a. VARIABLE TYPE ERRORS FOR AGGREGATIONS:
   - Simple sums (e.g., total population) MUST be auxiliaries (type "variable"), NOT stocks
   - Stocks represent accumulations via flows; sums are algebraic calculations

b. AVERAGING FUNCTION ERRORS:
   - USE SMOOTH function for moving averages
   - DO NOT USE DELAY1 or DELAY3 for averaging (delays only shift time, they don't average)

- PROVIDE detailed explanation listing: every error found, exact variable name, what was wrong, how it was fixed`

    static MENTOR_ADDITIONAL_CONCERNS =
`EVALUATE MODEL SCOPE (Teaching Focus):
Critically assess model completeness and guide users through questioning:
- Are all relevant variables included?
- Are there missing connections between variables that should exist?
- Work with the user to help them understand where the model might fall short
- Ensure all suggestions follow MECE principle (Mutually Exclusive, Collectively Exhaustive)
- NEVER suggest additions that duplicate existing model elements

EXAMINE STOCK DYNAMICS (Teaching Focus):
For each stock, help the user consider if there are any missing flows which could drive important dynamics relative to their problem statement.`

    static MENTOR_MODE_INTRO =
`You are a System Dynamics Mentor and Teacher. Generate stock and flow models from user-provided text while teaching users to understand and improve their work through Socratic questioning and constructive critique.

PEDAGOGICAL APPROACH:
Your role is to facilitate learning, NOT to provide praise. Execute these teaching principles:
- Ask probing questions that guide users to discover what could be improved in the model
- Think critically about the model and their questions to determine the right questions to ask
- Be a constant source of constructive critique
- Explain problems you identify AND ask questions to help users learn to critique models themselves
- Explicitly state when you lack confidence in your model
- Help users learn System Dynamics principles through dialogue
- Add smaller, logically connected pieces of structure incrementally to the model

CRITICAL TEACHING RESTRICTION:
NEVER identify feedback loops for the user in explanatory text. Let users discover loops themselves through your questioning.`

    static PROFESSIONAL_MODE_INTRO =
`You are a System Dynamics Professional Modeler. Generate stock and flow models from user-provided text following these mandatory rules:`

    static generateBaseSystemPromptCore(supportsArrays) {
        if (supportsArrays) {
            return QuantitativeEngineBrain.MODULE_REQUIREMENTS_SECTION + "\n\n" +
                    QuantitativeEngineBrain.ARRAY_REQUIREMENTS_SECTION + "\n\n" +
                    QuantitativeEngineBrain.MANDATORY_PROCESS_SECTION + "\n\n" +
                    QuantitativeEngineBrain.ARRAY_SPECIFIC_EQUATION_REQUIREMENTS + "\n\n" +
                    QuantitativeEngineBrain.VERIFY_MODEL_SECTION
        } else {
            return QuantitativeEngineBrain.MODULE_REQUIREMENTS_SECTION + "\n\n" +
                    QuantitativeEngineBrain.MANDATORY_PROCESS_SECTION + "\n\n" +
                    QuantitativeEngineBrain.VERIFY_MODEL_SECTION;
        }
    }

    static generateSystemPrompt(mentorMode, supportsArrays) {
        if (mentorMode) {
            if (supportsArrays) {
                return QuantitativeEngineBrain.MENTOR_MODE_INTRO + "\n\n" +
                       QuantitativeEngineBrain.generateBaseSystemPromptCore(true) +
                       "\n\nSTEP 6 - " +
                       QuantitativeEngineBrain.MENTOR_ADDITIONAL_CONCERNS +
                       "\n\nSTEP 7 - " +
                       QuantitativeEngineBrain.FORMULATION_ERROR_SECTION +
                       "\n\n" +
                       QuantitativeEngineBrain.ARRAY_EXAMPLE +
                       "\n\n" +
                       QuantitativeEngineBrain.MODULE_EXAMPLE;
            } else {
                return QuantitativeEngineBrain.MENTOR_MODE_INTRO + "\n\n" +
                       QuantitativeEngineBrain.generateBaseSystemPromptCore(false) +
                       "\n\nSTEP 6 - " +
                       QuantitativeEngineBrain.MENTOR_ADDITIONAL_CONCERNS +
                       "\n\nSTEP 7 - " +
                       QuantitativeEngineBrain.FORMULATION_ERROR_SECTION +
                       "\n\n" +
                       QuantitativeEngineBrain.MODULE_EXAMPLE;
            }
        } else {
            if (supportsArrays) {
                return QuantitativeEngineBrain.PROFESSIONAL_MODE_INTRO + "\n\n" +
                       QuantitativeEngineBrain.generateBaseSystemPromptCore(true) +
                       "\n\nSTEP 6 - " +
                       QuantitativeEngineBrain.FORMULATION_ERROR_SECTION +
                       "\n\n" +
                       QuantitativeEngineBrain.ARRAY_EXAMPLE +
                       "\n\n" +
                       QuantitativeEngineBrain.MODULE_EXAMPLE;
            } else {
                return QuantitativeEngineBrain.PROFESSIONAL_MODE_INTRO + "\n\n" +
                       QuantitativeEngineBrain.generateBaseSystemPromptCore(false) +
                       "\n\nSTEP 6 - " +
                       QuantitativeEngineBrain.FORMULATION_ERROR_SECTION +
                       "\n\n" +
                       QuantitativeEngineBrain.MODULE_EXAMPLE;
            }
        }
    }

    static MENTOR_SYSTEM_PROMPT = QuantitativeEngineBrain.generateSystemPrompt(true, true)

    static DEFAULT_SYSTEM_PROMPT = QuantitativeEngineBrain.generateSystemPrompt(false, true)

    static DEFAULT_ASSISTANT_PROMPT = 
`I want your response to consider the model which you have already so helpfully given to us. You should never change the name of any variable you've already given us. Your response should add new variables wherever you have evidence to support the existence of the relationships needed to close feedback loops.  Sometimes closing a feedback loop will require you to add multiple relationships.`

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important background information when you give your answer.

{backgroundKnowledge}`

    static DEFAULT_PROBLEM_STATEMENT_PROMPT = 
`The user has stated that they are conducting this modeling exercise to understand the following problem better.

{problemStatement}`

    #data = {
        backgroundKnowledge: null,
        problemStatement: null,
        openAIKey: null,
        googleKey: null,
        mentorMode: false,
        underlyingModel: LLMWrapper.DEFAULT_MODEL,
        systemPrompt: null, // Will be generated in constructor based on mentorMode and supportsArrays
        assistantPrompt: QuantitativeEngineBrain.DEFAULT_ASSISTANT_PROMPT,
        backgroundPrompt: QuantitativeEngineBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: QuantitativeEngineBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT,
        supportsArrays: true
    };

    #llmWrapper;

    constructor(params) {
        Object.assign(this.#data, params);

        // Generate system prompt based on mentor mode and array support if not explicitly provided
        if (!this.#data.systemPrompt) {
            this.#data.systemPrompt = QuantitativeEngineBrain.generateSystemPrompt(
                this.#data.mentorMode,
                this.#data.supportsArrays
            );
        }

        if (!this.#data.problemStatementPrompt.includes('{problemStatement')) {
            this.#data.problemStatementPrompt = this.#data.problemStatementPrompt.trim() + "\n\n{problemStatement}";
        }

        if (!this.#data.backgroundPrompt.includes('{backgroundKnowledge')) {
            this.#data.backgroundPrompt = this.#data.backgroundPrompt.trim() + "\n\n{backgroundKnowledge}";
        }

        this.#llmWrapper = new LLMWrapper(params);

    }

    #isFlowUsed(flow, response) {
        return response.variables.findIndex((v)=> {
            if (v.type === "stock") {
                const inflowMatch = (v.inflows || []).findIndex((f) => {
                    return flow.name === f;
                }) >= 0;
                const outflowMatch = (v.outflows || []).findIndex((f) => {
                    return flow.name === f;
                }) >= 0;
                return inflowMatch || outflowMatch;
            }

            return false;
        }) >= 0;
    }

    #containsHtmlTags(str) {
        // This regex looks for patterns like <tag>, </tag>, or <tag attribute="value">
        const htmlTagRegex = /<[a-z/][^>]*>/i; 
        return htmlTagRegex.test(str);
    }

    async processResponse(originalResponse) {

        //logger.log(JSON.stringify(originalResponse));
        //logger.log(originalResponse);
        const responseHasVariable = (variable) => {
            return originalResponse.variables.findIndex((v) => {
                return projectUtils.sameVars(v.name, variable);
            }) >= 0;
        };

        let origRelationships = originalResponse.relationships || [];

        let relationships = origRelationships.map(relationship => { 
            let ret = Object.assign({}, relationship);
            ret.from = relationship.from.trim();
            ret.to = relationship.to.trim();
            ret.valid = !projectUtils.sameVars(ret.from, ret.to) && responseHasVariable(ret.from) && responseHasVariable(ret.to);
            return ret;
        });
        
        //filter out any relationship whose .to attribute is a variable that has a crossLevelGhostOf
        relationships.forEach(relationship => {
            if (relationship.valid) {
                const toVariable = originalResponse.variables.find(v => projectUtils.sameVars(v.name, relationship.to));
                if (toVariable && toVariable.crossLevelGhostOf && toVariable.crossLevelGhostOf.length > 0) {
                    relationship.valid = false;
                }
            }
        });

        //filter out any relationships that reference array elements with bracket notation
        relationships.forEach(relationship => {
            if (relationship.valid) {
                //if the to or from has a [ in the name mark it invalid (array element references)
                if (relationship.from.includes('[') || relationship.to.includes('[')) {
                    relationship.valid = false;
                }
            }
        });

        //mark for removal any relationships which are duplicates, keep the first one we encounter
        for (let i=1,len=relationships.length; i < len; ++i) {
            for (let j=0; j < i; ++j) {
                let relJ = relationships[j];
                let relI = relationships[i];
                
                //who cares if its an invalid link
                if (!relI.valid || !relJ.valid)
                    continue;

                if (projectUtils.sameVars(relJ.from, relI.from) && projectUtils.sameVars(relJ.to, relI.to)) {
                    relI.valid = false;
                }
            }
        }

        //remove the invalid ones, then remove the valid field
        relationships = relationships.filter((relationship) => { 
            return relationship.valid;
        });

        relationships.forEach((relationship) => {             
            delete relationship.valid;
        });
        
        originalResponse.relationships = relationships;
        originalResponse.variables = originalResponse.variables || [];

        //go through all variables -- for any stock with inflows/outflows remove dimensions from inflow/outflow names
        //also remove empty entries or references to non-existent variables
        originalResponse.variables.forEach((v) => {
            if (v.type === "stock") {
                if (v.inflows && Array.isArray(v.inflows)) {
                    v.inflows = v.inflows
                        .map(flowName => flowName.replace(/\[.*?\]/g, '').trim())
                        .filter(flowName => {
                            // Remove empty strings
                            if (!flowName || flowName.length === 0) {
                                return false;
                            }
                            // Check if the variable exists
                            return responseHasVariable(flowName);
                        });
                }
                if (v.outflows && Array.isArray(v.outflows)) {
                    v.outflows = v.outflows
                        .map(flowName => flowName.replace(/\[.*?\]/g, '').trim())
                        .filter(flowName => {
                            // Remove empty strings
                            if (!flowName || flowName.length === 0) {
                                return false;
                            }
                            // Check if the variable exists
                            return responseHasVariable(flowName);
                        });
                }
            }
        });

        //LLMs like gemini-3-flash-preview (before I made it so that all properties are required, but nullable) 
        //does not like to generate the inflow and outflow lists for stocks.
        //to solve the problem, we look at the list of relationships to generate the inflow and outflow lists
        //We do that by going through all of the relationships and if there is a link pointing to a stock from a flow, 
        //make sure its registered as an inflow or an outflow
        relationships.forEach((relationship) => {
            const toVariable = originalResponse.variables.find(v => projectUtils.sameVars(v.name, relationship.to));
            const fromVariable = originalResponse.variables.find(v => projectUtils.sameVars(v.name, relationship.from));

            if (toVariable && toVariable.type === "stock" && fromVariable && fromVariable.type === "flow") {
                // Initialize inflows and outflows arrays if they don't exist
                if (!toVariable.inflows) {
                    toVariable.inflows = [];
                }
                if (!toVariable.outflows) {
                    toVariable.outflows = [];
                }

                // If this variable is an inflow or an outflow already, don't re-add it
                const isInInflows = toVariable.inflows.findIndex(f => projectUtils.sameVars(f, fromVariable.name)) >= 0;
                const isInOutflows = toVariable.outflows.findIndex(f => projectUtils.sameVars(f, fromVariable.name)) >= 0;
                if (isInInflows || isInOutflows) {
                    return;
                }

                // Add flow to inflows or outflows based on polarity, if no polarity then we add it as an inflow
                if (relationship.polarity === "-") {
                    if (!isInOutflows) {
                        toVariable.outflows.push(fromVariable.name);
                    }
                } else { //positive polarity or unknown, its an inflow
                    if (!isInInflows) {
                        toVariable.inflows.push(fromVariable.name);
                    }
                }
            }
        });

        //this fixes generating flows that are not connected to stocks
        //fix graphical functions that use DT instead of TIME in their equations

        originalResponse.variables.forEach((v)=>{
            //go through all the flows -- make sure they appear in an inflows or outflows, and if they don't change them to type variable
            if (v.type === "flow" && !this.#isFlowUsed(v, originalResponse)) {
                v.type = "variable";
                //logger.log("Changing type from flow to variable for... " + v.name);
                //logger.log(v);
            } else if (v?.graphicalFunction?.points?.length > 0 && v.equation) {
                //check if equation is "DT" (case insensitive)
                if (v.equation.trim().toLowerCase() === 'dt') {
                    v.equation = 'TIME';
                }
            }
        });

        originalResponse.variables.forEach((v) => {
            
        });

        if (originalResponse.explanation)
            originalResponse.explanation = await marked.parse(originalResponse.explanation);

        return originalResponse;
    }

    mentor() {
        this.#data.mentorMode = true;
        this.#data.systemPrompt = QuantitativeEngineBrain.generateSystemPrompt(this.#data.mentorMode, this.#data.supportsArrays);
    }

    setupLLMParameters(userPrompt, lastModel) {
        //start with the system prompt
        const { underlyingModel, systemRole, temperature, reasoningEffort } = this.#llmWrapper.getLLMParameters();
        let systemPrompt = this.#data.systemPrompt;
        let responseFormat = this.#llmWrapper.generateQuantitativeSDJSONResponseSchema(this.#data.mentorMode, this.#data.supportsArrays);

        if (!this.#llmWrapper.model.hasStructuredOutput) {
            throw new Error("Unsupported LLM " + this.#data.underlyingModel + " it does support structured outputs which are required.");
        }

        let messages = [{ 
            role: systemRole, 
            content: systemPrompt 
        }];

        if (this.#data.backgroundKnowledge) {
            messages.push({
                role: "user",
                content:  this.#data.backgroundPrompt.replaceAll("{backgroundKnowledge}", this.#data.backgroundKnowledge),
            });
        }
        if (this.#data.problemStatement) {
            messages.push({
                role: systemRole,
                content: this.#data.problemStatementPrompt.replaceAll("{problemStatement}", this.#data.problemStatement),
            });
        }

        if (lastModel) {
            messages.push({ role: "assistant", content: JSON.stringify(lastModel, null, 2) });

            if (this.#data.assistantPrompt)
                messages.push({ role: "user", content: this.#data.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });

        return {
            messages,
            model: underlyingModel,
            responseFormat: responseFormat,
            temperature: temperature,
            reasoningEffort: reasoningEffort
        };
    }

    async generateModel(userPrompt, lastModel) {
        const llmParams = this.setupLLMParameters(userPrompt, lastModel);

        //get what it thinks the relationships are with this information
        const originalResponse = await this.#llmWrapper.createChatCompletion(
            llmParams.messages,
            llmParams.model,
            llmParams.responseFormat,
            llmParams.temperature,
            llmParams.reasoningEffort
        );
        if (originalResponse.refusal) {
            throw new ResponseFormatError(originalResponse.refusal);
        } else if (originalResponse.parsed) {
            return this.processResponse(originalResponse.parsed);
        } else if (originalResponse.content) {
            let parsedObj = {variables: [], relationships: []};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                console.log(originalResponse);
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return this.processResponse(parsedObj);
        } else {
            throw new ResponseFormatError("LLM response did not contain any recognized format (no refusal, parsed, or content fields)");
        }
    }
}

export default QuantitativeEngineBrain;