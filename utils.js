let utils = {};

utils.xmileName = function(name) {
  let cleanName = name.replaceAll("\n", " ")
             .replaceAll("\r", " ");

  const splits = cleanName.split(" ").filter((c) => {
    return c !== " ";
  });

  return splits.join("_");
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