import express from 'express'
import config from './config.js'
import cors from 'cors'

import v1Initialize from './routes/v1/initialize.js'
import v1Engines from './routes/v1/engines.js'
import v1EngineParameters from './routes/v1/engineParameters.js'
import v1EngineGenerate from './routes/v1/engineGenerate.js'

const app = express()

app.use(cors())
app.use(express.json());
app.use(express.urlencoded({limit: '50mb', extended: true }));

if (app.get('env') === 'production') {
  app.set('trust proxy', 1) // trust first proxy
}

const restrictKeyCode = process.env.RESTRICT_KEY_CODE;

if (restrictKeyCode) {
  app.use((req, res, next) => {
    if (!req.header('Authentication') || req.header('Authentication') !== restrictKeyCode) {
      return res.status(403).send({ error: 'Unauthorized' });
    }
    next();
  });
}


app.use("/api/v1/initialize", v1Initialize);
app.use("/api/v1/engines", v1Engines);
app.use("/api/v1/engines/", v1EngineParameters); //:engine/parameters
app.use("/api/v1/engines/", v1EngineGenerate); //:engine/generate

app.listen(config.port, () => {
  console.log(`ai-proxy-service listening on port ${config.port}`);
});