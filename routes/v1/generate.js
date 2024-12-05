import express from 'express'

import utils from './../../helpers/utils.js'
import OpenAIWrapper from '../../helpers/OpenAIWrapper.js'

const router = express.Router()

//curl -d '{"userPrompt":"when death rate goes up, population decreases"}' -H "Content-Type: application/json" -X POST http://localhost:3000/api/v1/generate

router.post('/', async (req, res) => {
    const userPrompt = req.body.userPrompt;
    if (!userPrompt) {
        res.send({success: false, message: "Missing a userPrompt"});
        return;
    }

    const lastRelationshipList = req.body.lastRelationshipList;
    try {
        let wrapper = new OpenAIWrapper(req.session);
        const relationships = await wrapper.generateDiagram(userPrompt, lastRelationshipList);

        req.session.lastRelationshipList = wrapper.getLastRelationshipListStr(); //store this response so that we can re-use it
        req.session.userPrompts = wrapper.getUserPromptSessionStr(); //store this prompt so that we can replay it
        res.send({"success": true, xmile: utils.convertToXMILE(relationships), relationships: relationships});
        return;
    } catch(err) {
        console.error(err);
        res.send({success: false, message: "Failed to generate a diagram", err: err});
        return;
    }
})

export default router;