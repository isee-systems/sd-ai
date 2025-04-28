import OpenAI from "openai";

let utils = {};

//this will let us deny old clients in the future
utils.supportedPlatform = function(clientProduct, clientVersion) {
  if (!clientProduct || !clientVersion)
    return false;
  
  //both product and version may be null or undefined if not passed in
  return true;
}

utils.xmileName = function(name) {
  let cleanName = name.replaceAll("\n", " ")
             .replaceAll("\r", " ");

  const splits = cleanName.split(" ").filter((c) => {
    return c !== " ";
  });

  return splits.join("_");
}

utils.caseFold = function(name) {
  let xname = utils.xmileName(name);
  return xname.toLowerCase();
}

utils.convertToXMILE = function(sdJSON) {

  const relationships = sdJSON.relationships;

  let xmileConnectors = "";
  let xmileEqns = "";

  let variablesObj = {}; //variable to causers
  relationships.forEach(function(relationship) {
    if (!variablesObj[relationship.end]) {
      variablesObj[relationship.end] = [];
    }

    let arr = variablesObj[relationship.end];
    if (!arr.includes(relationship.start)) {
      arr.push(relationship.start);
      variablesObj[relationship.end] = arr;

      let polarity = "";
      if (relationship.polarity !== "?")
        polarity =  "polarity=\"" + relationship.polarity + "\"";

      xmileConnectors += "<connector " + polarity + ">";
      xmileConnectors += "<from>" + utils.xmileName(relationship.start) + "</from>";
      xmileConnectors += "<to>" + utils.xmileName(relationship.end) + "</to>";
      xmileConnectors += "</connector>";
    }
  });

  for (const [variable, causers] of Object.entries(variablesObj)) {
    let prettyName = variable.replaceAll("\n", "\\\n").replaceAll("\r", "\\\r");
    xmileEqns += "<aux name=\"" + prettyName + "\">";
    xmileEqns += "<eqn>NAN(";
    causers.forEach(function(cause, index) {
      if (index > 0)
        xmileEqns += ",";
      xmileEqns += utils.xmileName(cause);
    });
    xmileEqns += ")</eqn>";
    xmileEqns += "<isee:delay_aux/>";
    xmileEqns += "</aux>";
  }
  
  let value = '<?xml version="1.0" encoding="utf-8"?>';
  value += '<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:isee="http://iseesystems.com/XMILE">';
  value += '<header>';
  value += '<smile version="1.0" namespace="std, isee"/>';
  value += '<vendor>AI Proxy Service</vendor>';
  value += '<product version="1.0.0" lang="en">AI Proxy Service</product>';
  value += '</header>';
  value += '<model>';
  
  value += '<variables>';
  value += xmileEqns;
  value += '</variables>';

  value += '<views>';
  value += '<view type="stock_flow">';
  value += '<style><aux><shape type="name_only"/></aux></style>';
  value += xmileConnectors;
  value += '</view>';
  value += '</views>';
  value += '</model>';
  value += '</xmile>';

  return value;
};

export default utils; 

export const ModelType = Object.freeze({
  GEMINI:   Symbol("Gemini"),
  OPEN_AI:  Symbol("OpenAI"),
  LLAMA: Symbol("Llama"),
  DEEPSEEK: Symbol("Deepseek")
});


export class ModelCapabilities {
  hasStructuredOutput= true;
  hasSystemMode = true;
  hasTemperature = true;
  systemModeUser = 'system';

  name = 'model';

  constructor(modelName) {
      this.name = modelName;

      this.hasStructuredOutput = modelName !== 'o1-mini';
      this.hasSystemMode = modelName !== 'o1-mini';
      this.hasTemperature = !modelName.startsWith('o');
      if (modelName.includes('gemini') || modelName.includes('llama')) {
          this.systemModeUser = 'system';
      } else {
          this.systemModeUser = 'developer';
      }
  }

  get kind() {
      if (this.name.includes('gemini')) {
          return ModelType.GEMINI;
      } else if (this.name.includes('llama')) {
          return ModelType.LLAMA;
      } else if (this.name.includes('deepseek')) {
          return ModelType.DEEPSEEK;
      } else {
          return ModelType.OPEN_AI;
      }
  }
};

export class LLMWrapper {
  #openAIKey;
  #googleKey;
  
  model = new ModelCapabilities('gpt-4o');
  openAIAPI = null;

  constructor(parameters) {
    if (!parameters.openAIKey) {
        this.#openAIKey = process.env.OPENAI_API_KEY
    } else {
      this.#openAIKey = parameters.openAIKey;
    }

    if (!parameters.googleKey) {
        this.#googleKey = process.env.GOOGLE_API_KEY
    } else {
      this.#googleKey = parameters.googleKey;
    }

    if (parameters.underlyingModel)
      this.model = new ModelCapabilities(parameters.underlyingModel);

    switch (this.model.kind) {
        case ModelType.GEMINI:
            this.openAIAPI = new OpenAI({
                apiKey: this.#googleKey,
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
            });
            break;
        case ModelType.OPEN_AI:
            this.openAIAPI = new OpenAI({
                apiKey: this.#openAIKey,
            });
            break;
        case ModelType.DEEPSEEK:
        case ModelType.LLAMA:
            this.openAIAPI = new OpenAI({
                apiKey: 'junk', // required but unused
                baseURL: 'http://localhost:11434/v1',
            });
            break;
    }
  }

  static additionalParameters() {
    const models = [ 
        {label: "GPT-4o", value: 'gpt-4o'}, 
        {label: "GPT-4o-mini", value: 'gpt-4o-mini'}, 
        {label: "GPT-4.5-preview", value: 'gpt-4.5-preview'}, 
        {label: "GPT-4.1", value: 'gpt-4.1'}, 
        {label: "GPT-4.1-mini", value: 'gpt-4.1-mini'}, 
        {label: "GPT-4.1-nano", value: 'gpt-4.1-nano'}, 
        {label: "Gemini 2.5-flash", value: 'gemini-2.5-flash-preview-04-17'},
        {label: "Gemini 2.5-pro", value: 'gemini-2.5-pro-preview-03-25'},
        {label: "Gemini 2.0", value: 'gemini-2.0-flash'},
        {label: "Gemini 2.0-Lite", value: 'gemini-2.0-flash-lite'},
        {label: "Gemini 1.5", value: 'gemini-1.5-flash'},
        {label: "o1", value: 'o1'}, 
        {label: "o3-mini low", value: 'o3-mini low'}, 
        {label: "o3-mini medium", value: 'o3-mini medium'}, 
        {label: "o3-mini high", value: 'o3-mini high'},
        {label: "o4-mini", value: 'o4-mini'}
    ];

    return [{
            name: "openAIKey",
            type: "string",
            required: true,
            uiElement: "password",
            saveForUser: "global",
            label: "Open AI API Key",
            description: "Leave blank for the default, or your Open AI key - skprojectXXXXX"
        },{
            name: "googleKey",
            type: "string",
            required: true,
            uiElement: "password",
            saveForUser: "global",
            label: "Google API Key",
            description: "Leave blank for the default, or your Google API key - XXXXXX"
        },{
            name: "underlyingModel",
            type: "string",
            defaultValue: 'gpt-4o',
            required: false,
            options: models,
            uiElement: "combobox",
            saveForUser: "local",
            label: "LLM Model",
            description: "The LLM model that you want to use to process your queries."
        }];
    }
};

