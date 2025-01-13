import express from 'express'
import utils from './../../utils.js'

const router = express.Router()

router.post("/:engine/generate", async (req, res) => {
    const engine = await import(`./../../engines/${req.params.engine}/engine.js`);
    const instance = new engine.default();

    const prompt = req.body.prompt;
    let format = req.body.format;
  
    const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
       return ["prompt", "currentModel", "format"].indexOf(k) == -1
    }));

    let currentModel = {variables: [], relationships: []};
    if ('currentModel' in req.body) {
      currentModel = req.body.currentModel
    }
  
    let generateResponse = await instance.generate(prompt, currentModel, engineSpecificParameters);
  
    if (generateResponse.err) {
      return res.send({
        success: false,
        message: "Failed to generate a diagram: " + generateResponse.err
      })
    }
  
    let model = generateResponse.model
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