import express from 'express'
import config from './config.js'
import session from 'express-session'
import cors from 'cors'

import v1Initialize from './routes/v1/initialize.js'
import v1finalize from './routes/v1/finalize.js'

import utils from './utils.js'

import fs from 'fs'

const app = express()

app.use(cors())

let sess = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {}
};

if (app.get('env') === 'production') {
  app.set('trust proxy', 1) // trust first proxy
  sess.cookie.secure = true // serve secure cookies
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sess));

app.use(express.json());
app.get("/api/v1/engines", async (req, res) => {
    const path = "engines"
    const folders = fs.readdirSync(path).filter(f => fs.lstatSync(`${path}/${f}`).isDirectory());

    res.send({
        success: true, 
        engines: folders 
    });
    return;
})

app.get("/api/v1/engines/:engine/parameters", async (req, res) => {
  const engine = await import(`./engines/${req.params.engine}/engine.js`)
  const baseParameters = {
    "prompt": "type=string, required=true, description of desired model or changes to model",
    "format": "type=string, default='sd-json', options are <sd-json|xmile>",
    "currentModel": "type=object, default={}, json in sd-json format representing current model to anchor changes off of"
  }
  return res.send({
    sucess: true,
    parameters: {
      ...baseParameters,
      ...engine.additionalParameters()
    }
  })
});

app.post("/api/v1/engines/:engine/generate", async (req, res) => {
  const engine = await import(`./engines/${req.params.engine}/engine.js`)
  const prompt = req.body.prompt 
  const currentModel = req.body.currentModel

  const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
     return ["prompt", "current_model", "format"].indexOf(k) == -1
  }))

  let model = await engine.generate(prompt, currentModel, engineSpecificParameters)

  if (model.err) {
    return res.send({
      success: false,
      message: model.err
    })
  }

  let format = "sd-json"
  if (req.body.format == "xmile") {
    format = "xmile"
    model = utils.convertToXMILE(model)
  }

  return res.send({
    sucess: true,
    format: format,
    model: model 
  })
});

app.use("/api/v1/initialize", v1Initialize);
app.use("/api/v1/finalize", v1finalize);

app.listen(config.port, () => {
  console.log(`ai-proxy-service listening on port ${config.port}`);
});