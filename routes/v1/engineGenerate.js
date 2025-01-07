import express from 'express'
import fs from 'fs'
import { format } from 'path'

const router = express.Router()

router.post("/:engine/generate", async (req, res) => {
    const engine = await import(`./../../engines/${req.params.engine}/engine.js`);
    const instance = new engine.default();

    const prompt = req.body.prompt; 
    const currentModelJSON = req.body.currentModel;
    let format = req.body.format;
  
    const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
       return ["prompt", "currentModel", "format"].indexOf(k) == -1
    }));

    let currentModel = {variables: [], relationships: []};
    try {
      currentModel = JSON.parse(currentModelJSON);
    } catch (err) {
      return res.send({
        success: false,
        message: "Bad JSON format for currentModel: " + err.toString()
      })
    }
  
    let model = await instance.generate(prompt, currentModel, engineSpecificParameters);
  
    if (model.err) {
      return res.send({
        success: false,
        message: "Failed to generate a diagram: " + model.err
      })
    }
  
    if (format == "xmile") {
      model = utils.convertToXMILE(model)
    } else {
      format = "sd-json";
    }
  
    return res.send({
      success: true,
      format: format,
      model: model 
    })
})

export default router;