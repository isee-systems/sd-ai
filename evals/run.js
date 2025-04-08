const expirement = {
	engine_runs: [
		{
            engine: "predprey",
        }
	],
    criteria: [
        "causalTranslation"
    ],
};

expirement.engine_runs.forEach(async r => {
    console.log("Running evals for", r.engine);

    const engine = await import(`../engines/${r.engine}/engine.js`);
    const instance = new engine.default();
    console.log(instance.additionalParameters())

    const allTests = await Promise.all(expirement.criteria.map(async c => {
        console.log("interested in", c)
        const tests = await import(`./criteria/${c}.js`);
        return tests
    }))

    console.log(allTests)
  
    /*
    const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
       return ["prompt", "currentModel", "format"].indexOf(k) == -1
    }));
    */
  
    //let generateResponse = await instance.generate(prompt, currentModel, engineSpecificParameters);
})