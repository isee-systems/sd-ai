import * as fs from 'fs';
import { execSync } from "child_process"
import path from 'path';
import { fileURLToPath } from 'url';

import config from '../../config.js'
 
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

class Engine {
    constructor() {

    }

    additionalParameters()  {
        return [{
            name: "openAIKey",
            type: "string",
            required: true,
            uiElement: "password",
            saveForUser: "global",
            label: "Open AI API Key",
            description: "Leave blank for the default, or your Open AI key - skprojectXXXXX"
        },{
            name: "problemStatement",
            type: "string",
            required: false,
            uiElement: "textarea",
            saveForUser: "local",
            label: "Problem Statement",
            description: "Description of a dynamic issue within the system you are studying that highlights an undesirable behavior over time.",
            minHeight: 50,
            maxHeight: 100
        },{
            name: "backgroundKnowledge",
            type: "string",
            required: false,
            uiElement: "textarea",
            saveForUser: "local",
            label: "Background Knowledge",
            description: "Background information you want the LLM model to consider when generating a diagram for you",
            minHeight: 100
        }];
    }

    async generate(prompt, currentModel, parameters) {
        let external = {
            prompt: prompt,
            currentModel: currentModel,
            parameters: parameters
        };

        let tempDir;
        try {
            tempDir = fs.mkdtempSync(config.externalEngineDir);
            fs.writeFileSync(path.join(tempDir, 'data.json'), JSON.stringify(external));
            fs.copyFileSync(path.join(__dirname, "ExternalEngine.py"), path.join(tempDir, "ExternalEngine.py"));
            const result = execSync('python3 ExternalEngine.py', {cwd: tempDir});
            
            return JSON.parse(result.toString());
        } catch (err) {
            console.error(err);
            return { 
                err: err.toString() 
            };
        } finally {
            if (tempDir)
                fs.rmSync(tempDir, {recursive: true, force: true});
        }
    }
}

export default Engine;