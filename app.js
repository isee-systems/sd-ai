import express from 'express'
import config from './config.js'
import session from 'express-session'

import v1Initialize from './routes/v1/initialize.js'
import v1QueryInfo from './routes/v1/query-info.js'
import v1Generate from './routes/v1/generate.js'
import v1finalize from './routes/v1/finalize.js'

const app = express()

console.log("Your OpenAI API key is... " + process.env.OPENAI_API_KEY);

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
app.use("/api/v1/query-info", v1QueryInfo);
app.use("/api/v1/initialize", v1Initialize);
app.use("/api/v1/generate", v1Generate);
app.use("/api/v1/finalize", v1finalize);

app.listen(config.port, () => {
  console.log(`ai-proxy-service listening on port ${config.port}`);
});