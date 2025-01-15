# sd-ai
Fully open source web service that generates causal loop diagrams from user prompts. This service supports the AI functionality found in Stella (v3.8.0 or greater) (https://www.iseesystems.com/store/products/stella-architect.aspx) and CoModel(https://comodel.io).

# Goals
- provide pathways for folks with different levels of technical skill to get involved in refining best practices for using LLMs in System Dynamics work
- provide a centralized location for the current state of the art for using LLMs in SD work
- provide a flexible framework to support immediate integration of new AI concepts into existing SD applications
- begin to support AI generation of quantitative SD models
- easily support swapping out OpenAI for other LLM vendors or even generate models without using LLM techniques

# Get Involved
we welcome Github Issues and Pull Requests on the following:
- [easy] feedback on your experience building CLDs in either Stella (using AI Assistant) or CoModel (using Copilot)
- [medium] prompt engineering recommendations surfaced by using "Advanced" Assistant in Stella
- [hard] refinement of the `default` (our state of the art) engine or contribution of a brand new AI engine

# Architecture and Data Structures 
- sd-ai is a NodeJS Express app that works with a series of simple JSON-encoded HTTP requests
- all AI functionality in sd-ai is implemented as a specific "engine" 
- an engine is a javascript class that implements ai functionality using any libraries/apis supported by javascript
    - `/engines` folder contains the simplest possible engine: `predprey` and the current state of the art: `default`
- sd-ai wraps engines to provides endpoints to:
    - list all engines
    - list parameters required/supported by each specific engine
    - generating a model using a specific engine
- models can be returned in sd-json (see below) or XMILE

## Engine

### Additional Parameters
- defines additional parameters your AI model can be passed 
- defined via `additionalParameters()` function on each engine class
- this format makes it so your engine can be automatically incorporated into the Stella GUI

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
- workhorse of the service, does the job of diagram generation
- a complete diagram should be returned by each request, even if it's simple returning the same diagram the user passed in via `currentModel`
- defined via `generate(prompt, currentModel, parameters)` function on each engine class
- must be json encoded POST request
- takes at least 3 post parameters, in addition to other parameters found via `/api/v1/:engine/parameters`

#### API Example
- `POST` `/api/v1/:engine/generate`
```
{
    "prompt": "", # Requested model or changes to model to be provided to the AI
    "format": "xmile", # The return type for the information. Either sd-json or xmile, default is sd-json",
    "currentModel": { "relationships": [], "variables": []} # Optional sd-json representation of the current model
}
```
- Returns `{success: <bool>, format: <string>, model: {variables: [], relationships: []},  supportingInfo: {} }`

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
        "polarity": <string "+" or "-" or "">, 
        "polarityReasoning": <string explanation for why this polarity was chosen> 
    }]
}
```  

# Engine Development
1. fork this repo and git clone your fork locally 
2. create an `.env` file at the top level which has the following keys:
 * OPENAI_API_KEY if you're doing work with `default` or `advanced` engine or any engine that uses the OpenAIWrapper.js class 
 * AUTHENTICATION_KEY only needed for securing publically accessible deployments. Requires client pass an Authentication header matching this value. e.g. `curl -H "Authentication: my_super_secret_value_in_env_file"` to every request
2. npm install 
3. npm start

We recommend VSCode using a launch.json for the Node type applications (you get a debugger, and hot-reloading)

# Inspiration and Related Work
- https://github.com/bear96/System-Dynamics-Bot served as departure point the `default` prompts
- https://comodel.io created by the team at Skip Designed (https://skipdesigned.com/)