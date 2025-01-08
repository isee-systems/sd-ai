import fs from "fs";
import projectUtils from '../../utils.js'

let utils = {};

//this will let us deny old clients in the future
utils.supportedPlatform = function(clientProduct, clientVersion) {
  if (!clientProduct || !clientVersion)
    return false;
  
  //both product and version may be null or undefined if not passed in
  return true;
}

utils.arrayify = function(chatGPTObj) {
  let arr = [];
  for (const [key, value] of Object.entries(chatGPTObj)) {
      arr.push(value);
  }

  return arr;
}

utils.caseFold = function(variableName) {
  let xname = projectUtils.xmileName(variableName);
  return xname.toLowerCase();
}

function getSubDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}

async function setupPromptingSchemes() {
  return new Promise((success)=> {
    console.log("Reading prompt directory")
    let response = {};
    const dirname = './engines/default/prompts/';
    
    const dirnames = getSubDirectories(dirname);
    dirnames.forEach(function(subDir) {
      const systemPrompt = fs.readFileSync(dirname + subDir + "/system.txt", 'utf-8'); 
      const feedbackPrompt = fs.readFileSync(dirname + subDir + "/feedback.txt", 'utf-8'); 
      const assistantPrompt = fs.readFileSync(dirname + subDir + "/assistant.txt", 'utf-8'); 
      const backgroundPrompt = fs.readFileSync(dirname + subDir + "/background.txt", 'utf-8');

      response[subDir] = {
        displayName: subDir,
        systemPrompt: systemPrompt,
        feedbackPrompt: feedbackPrompt,
        assistantPrompt: assistantPrompt,
        backgroundPrompt: backgroundPrompt
      };
    });
    success(response);
    return;
  });
};

utils.promptingSchemes = await setupPromptingSchemes();

export default utils; 