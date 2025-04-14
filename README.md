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
- **Techy folks**
   - prompt engineering recommendations surfaced by using "Advanced" Assistant in Stella
- **Peeps comfortable with programming**
    - refinement of the `default` (our state of the art) engine or contribution of a brand new AI engine

# Architecture and Data Structures 
- sd-ai is a NodeJS Express app with simple JSON-encoded HTTP API
- all AI functionality in sd-ai is implemented as an "engine"
- an engine is a javascript class that can implement ai functionality using any libraries/apis supported by javascript
    - `/engines` folder contains examples including the simplest possible engine: `predprey` and the current state of the art engine: `default`
- sd-ai wraps engines to provides endpoints to:
    - list all engines
    - list parameters required/supported by each specific engine
    - generating a model using a specific engine
- models can be returned in sd-json (see below) or XMILE

## Engine
- an engine only needs to do 2 things:
    - provide a function to generate a model based on a prompt
    - tell us what additional parameters users can pass to it

### Additional Parameters
- defined via `additionalParameters()` function on each engine class
- format specifically crafted to allow your engine to be automatically incorporated into the Stella GUI

#### API Example
- `GET` `/api/v1/engines/:engine/parameters`
- Returns 
```
{ 
    success: <bool>, 
    parameters:[{
        name: <string, unique name for the parmater that is passed to generate call>,
        type: <string, currently this service only supports 'string' for this attribute>,
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
    "format": "xmile", # The return type for the information. Either sd-json or xmile, default is sd-json",
    "currentModel": { "relationships": [], "variables": []} # Optional sd-json representation of the current model
    ....
    # additionalParameters given by `/api/v1/:engine/parameters`
}
```
- Returns
```
{
    success: <bool>,
    format: <string>,
    model: {variables: [], relationships: []},
    supportingInfo: {} # only provided if supported by engine
}
```

## SD-JSON
```
{
    variables: [{
        name: <string>,
        type: <string - stock|flow|variable>,
        eqn: <string - XMILE equation, not used yet>
    }], 
    relationships: [{
        "reasoning": <string, explanation for why this relationship is here> 
        "from": <string, the variable the connection starts wtih>,
        "to": <string, the variable the connection ends with>,  
        "polarity": <string "+" or "-" or "" >, 
        "polarityReasoning": <string explanation for why this polarity was chosen> 
    }]
}
```  

# Setup
1. fork this repo and git clone your fork locally 
2. create an `.env` file at the top level which has the following keys:
```
OPENAI_API_KEY="sk-asdjkshd" # if you're doing work with `default` or `advanced` engine or any engine that uses the OpenAIWrapper.js class 
GOOGLE_API_KEY="asdjkshd" # if you're doing work with `advanced` using any of the supported gemini engines 
AUTHENTICATION_KEY="my_secret_key" # only needed for securing publically accessible deployments. Requires client pass an Authentication header matching this value. e.g. `curl -H "Authentication: my_super_secret_value_in_env_file"` to the engine generate request only
```
3. npm install 
4. npm start

We recommend VSCode using a launch.json for the Node type applications (you get a debugger, and hot-reloading)

# Evals Usage
- execute evals with `npm run eval -- -e evals/experiments/leaderboard.json`, this will do 2 things:
    - allow you to first review the engines, tests and configuration that evals intends to run
    - execute the tests, creating several results files in top-level project directory 

## Experiment Files
- everything is configured in the required (`-e`) experiment json file
- by default two experiments are included by you're welcome to add your own
    - `evals/experiments/leaderboard.json` runs every engine against every test
    - `evals/experiments/careful.json`, is an example of using evals for testing and development
        - `verbose: true`: removes the progress bar in favor of detailed output
        - `sequential: true`: runs only a single test at a time

## Test Definitions
- all tests are located in the `categories` folder and have 3 layers:
    - **category**: high-level capability we want to measure e.g. bias, causal reasoning, bias, safety, etc
    - **group**: a collection of tests
    - **test**: specific definition with expected result and breakdown of failures
- the `categories` value in `experiment.json ` files specifies which tests are run
    - the key references a specific filename within `evals/categories/` that defines the tests that will run
    - `categoryName: true` will run all groups for that category or you can run just the groups you want with `categoryName: [ "specificGroupsOnly" ]`
- all `categories/$category.js` files must export a: 
    - `groups` object that maps group names to a list of tests
    - `evaluate` function takes in the relationships generated by a running a test compares those against the `expectations` for the test
        - it returns a simple list of `failure` objects where each failure must have a `type` and can optionally include details as well 
- all `tests` must have a `name` `prompt` and `expectations` object
    - `additionalParameters` can be specified if, for example, you have a `problemStatement` you wish to provide to the engine's generate
    - `expectations` is an object you can put anything in, we just hold on to it then pass it back to your `evaluate` function later

## Managing Rate Limits 
- lots of engines run via 3rd-party llm providers who are agressive about rate limiting
- running each model carefully with the number of tokens response to get a sense of max tokens
- then just check the teiring limits for everything else
- defualt values intended to be safe for google and openai non-reasoning models
"tokensPerMinute (TPM)": engineTests[0].engineConfig.limits.tokensPerMinute + 
    (engineTests[0].engineConfig.limits.tokensPerMinute != TOKENS_PER_MINUTE ? "*" : ""),
"requestsPerMinute (RPM)": engineTests[0].engineConfig.limits.requestsPerMinute + 
    (engineTests[0].engineConfig.limits.requestsPerMinute != REQUESTS_PER_MINUTE ? "*" : ""),
"baselineTokenUsage": engineTests[0].engineConfig.limits.baselineTokenUsage + 
    (engineTests[0].engineConfig.limits.baselineTokenUsage != BASELINE_TOKEN_USAGE ? "*" : ""),

## Tips for using current model
- default limits in `leaderboard.json` experiment should be pretty safe, **unless you're using a reasoning model**
    - especially on "high reasoning" mode 
- https://platform.openai.com/settings/organization/limits
- print the expected tokens
    - console.log("Our calculation for additional tokens beyond max: ", additionalTestParametersTokenCount);
- responses from the llm will tell you definitively how many tokens are used
    - `console.log(originalCompletion, underlyingModel);`
- you can patch in a warning when you get close to or exceed the rate limit
- ``` 
    fetch: async (url, init) => {
        // we need to clone this because we're gonna read the json response and once you do that 
        // you can't reread the response body again later for processing
        const originalResponse = await fetch(url, init);
        const response = originalResponse.clone();

        if (parseInt(response.headers.get('x-ratelimit-remaining-requests', '11')) < 100000 || 
            parseInt(response.headers.get('x-ratelimit-remaining-tokens', '4100')) < 5000) {
            console.log("getting scary close to rate limit");
            for (const [key, value] of response.headers) {
                if (key.startsWith('x-ratelimit')) {
                    console.log(`${key}: ${value}`);
                }
            }
            const j = await response.json()
            console.log("usage: ", j.usage);
            console.log("error: ", j.error);
        }
        return originalResponse;
    },
```
- when you have multiple engine configs leaning on the same underling model, usually makes sense to split tokens and requests per minute over all f them

# Inspiration and Related Work
- https://github.com/bear96/System-Dynamics-Bot served as departure point the `default` prompts
- [CoModel](https://comodel.io) created by the team at [Skip Designed](https://skipdesigned.com/) to use Generative AI in their CBSD work
