
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

utils.prettyifyName = function(variable) {
  return variable.replaceAll("\n", "\\\n").replaceAll("\r", "\\\r");
}

utils.sameVars = function(a,b) {
    return utils.caseFold(a) === utils.caseFold(b);
}

utils.isValidFeedbackContent = function(feedbackContent) {
  if (!feedbackContent) {
    return false;
  }

  if (feedbackContent.hasOwnProperty('valid') && !feedbackContent.valid) {
    return false;
  }

  if (Array.isArray(feedbackContent) && feedbackContent.length < 1) {
    return false;
  }

  return true;
}

// EVALUATION UTILITIES - These functions are specifically designed for evaluation categories

/**
 * Normalizes a variable name for case-insensitive and whitespace/underscore-insensitive comparison
 * Used in evaluation categories to match variable names flexibly
 * @param {string} name The variable name to normalize
 * @returns {string} Normalized name (lowercase, spaces and underscores removed)
 */
utils.evalsNormalizeVariableName = function(name) {
    return name.toLowerCase().replace(/[\s_-]/g, '');
};

/**
 * Checks if a variable name matches the expected name using flexible matching
 * Used in evaluation categories to compare generated variable names with expected names
 * @param {string} variableName The variable name from the generated model
 * @param {string} expectedName The expected variable name
 * @returns {boolean} True if names match
 */
utils.evalsVariableNameMatches = function(variableName, expectedName) {
    const normalizedVariable = utils.evalsNormalizeVariableName(variableName);
    const normalizedExpected = utils.evalsNormalizeVariableName(expectedName);
    return normalizedVariable.includes(normalizedExpected) || normalizedExpected.includes(normalizedVariable);
};

/**
 * Standardized array of gibberish nouns for use across evaluation categories
 */
utils.evalsGibberishNouns = [ "frimbulator",  "whatajig", "balack", "whoziewhat", "funkado", "maxabizer", "marticatene", "reflupper", "exeminte", "oc", "proptimatire", "priary", "houtal", "poval", "auspong", "dominitoxing", "outrance", "illigent", "yelb", "traze", "pablanksill", "posistorather", "crypteral", "oclate", "reveforly", "yoffa", "buwheal", "geyflorrin", "ih", "aferraron", "paffling", "pershipfulty", "copyring", "dickstonyx", "bellignorance", "hashtockle", "succupserva", "relity", "hazmick", "ku", "obvia", "unliescatice", "gissorm", "phildiscals", "loopnova", "hoza", "arinterpord", "burgination", "perstablintome", "memostorer", "baxtoy", "hensologic", "estintant", "perfecton", "raez", "younjuring"];



export default utils; 


