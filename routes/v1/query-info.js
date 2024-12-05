import express from 'express'

import utils from '../../helpers/utils.js'

const router = express.Router()

router.get('/', async (req, res) => {
    const models = [
        'chatgpt-4o-latest', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
        'o1-preview', 'o1-mini'
    ];
    res.send({success: true, models: models, promptingSchemes: Object.keys(utils.promptingSchemes) });
    return;
})

export default router;