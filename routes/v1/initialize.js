import express from 'express'
import OpenAI from "openai";

import config from './../../config.js'
import utils from '../../engines/default/utils.js'

const router = express.Router()

router.get('/', async (req, res) => {
    const clientProduct = req.query.clientProduct;
    const clientVersion = req.query.clientVersion;

    const openAIKey = req.query.openAIKey;
    const openAIModel = req.query.openAIModel;
    const promptSchemeId = req.query.promptSchemeId;

    if (!utils.supportedPlatform(clientProduct, clientVersion)) {
        res.send({success: false, message: "Your client application is not currently supported."});
        return;
    }

    req.session.openAIModel = openAIModel;
    req.session.openAIKey = openAIKey
    req.session.promptSchemeId = promptSchemeId;

   return res.send({success:true, message: "Diagram generation session is ready."});
})

export default router;