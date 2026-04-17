import express from 'express'
import config from './config.js'
import cors from 'cors'
import logger from './utilities/logger.js'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

import v1Initialize from './routes/v1/initialize.js'
import v1Engines from './routes/v1/engines.js'
import v1EngineParameters from './routes/v1/engineParameters.js'
import v1EngineGenerate from './routes/v1/engineGenerate.js'
import v1EvalsList from './routes/v1/evalsList.js'
import v1EvalsTestDetails from './routes/v1/evalsTestDetails.js'
import v1Leaderboard from './routes/v1/leaderboard.js'

import { SessionManager } from './agent/utilities/SessionManager.js'
import { handleWebSocketConnection } from './agent/websocket.js'

const app = express()

app.use(cors())
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true }));

if (app.get('env') === 'production') {
  app.set('trust proxy', 1) // trust first proxy
}

// Initialize Session Manager (before routes)
const sessionManager = new SessionManager();

app.use("/api/v1/initialize", v1Initialize);
app.use("/api/v1/engines", v1Engines);
app.use("/api/v1/engines/", v1EngineParameters); //:engine/parameters
app.use("/api/v1/engines/", v1EngineGenerate); //:engine/generate
app.use("/api/v1/evals", v1EvalsList);
app.use("/api/v1/evals", v1EvalsTestDetails);
app.use("/api/v1/leaderboard", v1Leaderboard);

// Create HTTP server for REST API
const server = createServer(app);

// Create separate HTTP server for WebSocket
const wsHttpServer = createServer();

// Create WebSocket server on separate port
const wss = new WebSocketServer({
  server: wsHttpServer,
  path: '/api/v1/agent'
});

wss.on('connection', (ws) => {
  handleWebSocketConnection(ws, sessionManager);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.log('SIGTERM received, shutting down gracefully...');
  wss.clients.forEach(ws => ws.close(1000, 'Server shutting down'));
  sessionManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.log('SIGINT received, shutting down gracefully...');
  wss.clients.forEach(ws => ws.close(1000, 'Server shutting down'));
  sessionManager.shutdown();
  process.exit(0);
});

// Start HTTP server
server.listen(config.port, () => {
  logger.log(`ai-proxy-service listening on port ${config.port}`);
});

// Start WebSocket server on separate port
wsHttpServer.listen(config.websocketPort, () => {
  logger.log(`WebSocket server listening on port ${config.websocketPort}`);
  logger.log(`WebSocket server available at ws://localhost:${config.websocketPort}/api/v1/agent`);
});
