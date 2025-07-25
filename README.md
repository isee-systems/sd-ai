# sd-ai
Fully open source web service that generates causal loop diagrams from user prompts. This service supports the AI functionality found in [Stella](https://www.iseesystems.com/store/products/stella-architect.aspx) (v3.8.0 or greater) and [CoModel](https://comodel.io).

# Goals
- provide pathways for folks with different levels of technical skill to get involved in refining best practices for using LLMs in System Dynamics work
- provide a centralized location for the current state of the art for using LLMs in SD work
- provide a flexible framework to support immediate integration of new AI concepts into existing SD applications
- begin to support AI generation of quantitative SD models
- easily support swapping out OpenAI for other LLM vendors or even generate models without using LLMs

# Get Involved
Join the discussion on the [sd-ai groups.io](https://groups.io/g/sd-ai/)<br/><br/> 
We welcome Github Issues and Pull Requests from everyone! Here are some ideas for how to support this work:
- **Anyone with an SD background**
    - feedback on your experience building CLDs in either Stella (using AI Assistant) or CoModel (using Copilot)
    - join [BEAMS](https://www.buffalo.edu/ai-data-science/research/beams.html) to steer our strategy for evaluating the accuracy, safety and bias of sd-ai models
- **Techy folks**
   - prompt engineering recommendations surfaced by using "Advanced" Assistant in Stella
- **Peeps comfortable with programming**
    - refinement of existing engines (like `qualitative`, `quantitative`, or `seldon`) or contribution of a brand new AI engine
    - add or refine our [evals](#evals) used to measure model performance according to [BEAMS](https://www.buffalo.edu/ai-data-science/research/beams.html) goals

# Architecture and Data Structures 
- sd-ai is a NodeJS Express app with simple JSON-encoded HTTP API
- all AI functionality in sd-ai is implemented as an "engine"
- an engine is a javascript class that can implement ai functionality using any libraries/apis supported by javascript
    - `/engines` folder contains examples including the simplest possible engine: `predprey` and engines like `qualitative`, `quantitative`, and `seldon`
- sd-ai wraps engines to provides endpoints to:
    - list all engines
    - list parameters required/supported by each specific engine
    - generating a model using a specific engine
- all engines can be automatically tested for quality using `evals`

## Engine
- an engine only needs to do 2 things:
    - provide a function to generate a model based on a prompt
    - tell us what additional parameters users can pass to it

### Additional Parameters
- defined via `additionalParameters()` function on each engine class
- format specifically crafted to allow your engine to be automatically incorporated into the Stella GUI and the sd-ai website

#### API Example
- `GET` `/api/v1/engines/:engine/parameters`
- Returns 
```
{ 
    success: <bool>, 
    parameters:[{
        name: <string, unique name for the parmater that is passed to generate call>,
        type: <string, string|number|boolean>,
        required: <boolean, whether or not this parameter must be passed to the generate call>,
        uiElement: <string, type of UI element the client should use so that the user can enter this value.  Valid values are textarea|lineedit|password|combobox|hidden|checkbox>,
        label: <string, name to put next to the UI element in the client>,
        description: <string, description of what this parameter does, used as a tooltip or placeholder text in the client>,
        defaultValue: <string, default value for this parameter if there is one, otherwise skipped>,
        options: <array, of objects with two attributes 'label' and 'value' only used if 'uiElement' is combobox>,
        saveForUser: <string, whether or not this field should be saved for the user by the client, valid values are local|global leave unspecified if not saved>,
        minHeight: <int, NOT REQUIRED, default 100 only relevant if 'uiElement' is textarea -- this is the minimum height of that text area>,
        maxHeight: <int, NOT REQUIRED, default intmax, only relevant if 'uiElement' is textarea -- this is the maximum height of that text area>
    }] 
}
```

### Generate
- does the job of diagram generation, it's the workhorse of the engine
- defined via `generate(prompt, currentModel, parameters)` function on each engine class
- a complete diagram should be returned by each request, even if that just means returning an empty diagram or the same diagram the user passed in via `currentModel`
  
#### API Example
- `POST` `/api/v1/:engine/generate`
- JSON data
```
{
    "prompt": "", # Requested model or changes to model to be provided to the AI
    "currentModel": { "relationships": [], "variables": []} # Optional sd-json representation of the current model
    ....
    # additionalParameters given by `/api/v1/:engine/parameters`
}
```
- Returns
```
{
    success: <bool>,
    model: {variables: [], relationships: [], specs?: {} },
    supportingInfo?: {} # only provided if supported by engine
}
```

## SD-JSON
```
{
    variables: [{
        name: <string>,
        type: <string - stock|flow|variable>,
        equation?: <string>,
        documentation?: <string>,
        units?: <string>,
        inflows?: Array<string>,
        outflows?: Array<string>,
        graphicalFunction?: {
            points: [
                {x: <number>, y: <number>}
                ...
            ]
        }
    }], 
    relationships: [{
        "reasoning?": <string, explanation for why this relationship is here> 
        "from": <string, the variable the connection starts wtih>,
        "to": <string, the variable the connection ends with>,  
        "polarity": <string "+" or "-" or "" >, 
        "polarityReasoning?": <string explanation for why this polarity was chosen> 
    }],
    specs?: {
        startTime: <number>,
        stopTime: <number>,
        dt?: <number>,
        timeUnits?: <string>
    }
}
```  
? denotes an optional attribute

## Discussion Engine JSON response
```
{
    output: {
        textContent: <string, the response to the query from the user>
    }
}
```  

# Setup
1. fork this repo and git clone your fork locally 
2. create an `.env` file at the top level which has the following keys:
```
OPENAI_API_KEY="sk-asdjkshd" # if you're doing work with engines that use the LLMWrapper class in utils.js (quantitative, qualitative, seldon, etc.) 
GOOGLE_API_KEY="asdjkshd" # if you're doing work with engines using Gemini models (causal-chains, seldon, quantitative, qualitative) 
AUTHENTICATION_KEY="my_secret_key" # only needed for securing publically accessible deployments. Requires client pass an Authentication header matching this value. e.g. `curl -H "Authentication: my_super_secret_value_in_env_file"` to the engine generate request only
```
3. npm install 
4. npm start
5. (optional) npm run evals -- -e evals/experiments/careful.json
6. (optional) npm test
7. (optional) npm test:coverage

We recommend VSCode using a launch.json for the Node type applications (you get a debugger, and hot-reloading)

If you wish to run using the causal-chains engine you'll need to install the [Go toolchain](https://go.dev/doc/install) onto your PATH.

## Testing
### Unit Tests
Unit tests are provided for:
- **HTTP API routes** in `/routes/v1` folder:
  - `engineParameters.test.js` - Validates that all engines return correct parameters
  - `engineGenerate.test.js` - Tests model generation endpoints with authentication, parameter validation, and response structure
  - `engines.test.js` - Tests engine listing and metadata endpoints
- **Engine implementations** in `/engines` folder:
  - `QuantitativeEngineBrain.test.js` - Tests quantitative model generation and LLM setup
  - `QualitativeEngineBrain.test.js` - Tests qualitative diagram generation
  - `SeldonBrain.test.js` - Tests discussion engine functionality
- **Evaluation methods** in `/evals/categories` - Tests cover causal relationship evaluation, conformance validation, and quantitative model assessment

Run tests with:
```bash
npm test
```

Generate code coverage report with:
```bash
npm run test:coverage
```

Tests are built using Jest and Supertest, and use the actual engine implementations (no mocking) to ensure real-world functionality.

## Evals
- checkout the [Evals README](evals/README.md)

  
# Inspiration and Related Work
- https://github.com/bear96/System-Dynamics-Bot served as departure point for engine prompt development
- [CoModel](https://comodel.io) created by the team at [Skip Designed](https://skipdesigned.com/) to use Generative AI in their CBSD work
