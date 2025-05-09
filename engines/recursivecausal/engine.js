import Engine from '../default/engine.js';
import AdvancedEngineBrain from '../default/AdvancedEngineBrain.js';
import { LLMWrapper } from '../../utils.js';

class RecursiveCausalEngine extends Engine {
  additionalParameters() {
    return super.additionalParameters().concat([
      {
        name: "mainTopics",
        type: "string",
        required: true,
        uiElement: "textarea",
        saveForUser: "local",
        label: "Main Topics",
        description: "Comma-separated list of main variables or topics to explore",
        minHeight: 50,
      },
      {
        name: "depth",
        type: "number",
        required: true,
        uiElement: "number",
        saveForUser: "local",
        label: "Depth",
        description: "How many layers of cause/effect to explore",
      },
    ]);
  }

  async generate(prompt, currentModel, parameters) {
    try {
      const wrapper = new LLMWrapper(parameters);
      const brain = new AdvancedEngineBrain({
        ...parameters,
        openAIKey: parameters.openAIKey,
        googleKey: parameters.googleKey,
        underlyingModel: parameters.underlyingModel || LLMWrapper.DEFAULT_MODEL,
        problemStatement: prompt,
      });

      const mainTopics = parameters.mainTopics
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x.length > 0);

      const maxDepth = parameters.depth;
      const explored = new Set();
      let allRelationships = [];

      const exploreTopic = async (topic, depth) => {
        if (depth > maxDepth || explored.has(topic)) return;
        explored.add(topic);

        const topicPrompt = `Given the following text:"""
${prompt}
"""
\nIdentify causes (drivers) and effects (impacts) of the topic: "${topic}" present in the text. If there are no causes or effects, return an empty array.
\nReturn the relationships as a JSON array where each relationship has:
- from: variable (short, neutral noun phrase, 5 words or fewer)
- to: variable (short, neutral noun phrase, 5 words or fewer)
- polarity: + or -
- reasoning: why this relationship exists
- polarityReasoning: why this polarity (+ or -) is appropriate.`;

        const result = await brain.generateDiagram(topicPrompt, { relationships: [] });
        if (!result.relationships || result.relationships.length === 0) return;

        allRelationships.push(...result.relationships);

        const nextTopics = new Set();
        for (const rel of result.relationships) {
          const from = rel.from.toLowerCase();
          const to = rel.to.toLowerCase();
          if (!explored.has(from)) nextTopics.add(from);
          if (!explored.has(to)) nextTopics.add(to);
        }

        for (const nextTopic of nextTopics) {
          await exploreTopic(nextTopic, depth + 1);
        }
      };

      for (const topic of mainTopics) {
        await exploreTopic(topic, 1);
      }

      const cleaned = await this.cleanRelationships(allRelationships, prompt, wrapper);
      const polished = await this.adjustPolarities(cleaned, prompt, wrapper);
      const variables = [...new Set(polished.flatMap((r) => [r.from, r.to]))];

      return {
        supportingInfo: {
          explanation: "Recursive causal relationships extracted and polished up to specified depth.",
          title: "Recursive Causal Map",
        },
        model: {
          relationships: polished,
          variables,
        },
      };
    } catch (err) {
      console.error(err);
      return { err: err.toString() };
    }
  }

  async cleanRelationships(relationships, prompt, wrapper) {
    if (!relationships || relationships.length === 0) return relationships;

    const schema = wrapper.generateSDJSONResponseSchema();
    const cleanPrompt = `Given the following text: """${prompt}"""
And the following causal relationships:

${JSON.stringify(relationships, null, 2)}

Please:
1. Normalize variable names (short, neutral phrases, 3 words or fewer)
2. Merge variables that refer to the same thing
3. Remove duplicate or redundant relationships
Return the cleaned relationships as a JSON array in the same format.`;

    const completion = await wrapper.openAIAPI.chat.completions.create({
      model: wrapper.model.name,
      temperature: 0,
      messages: [
        { role: wrapper.model.systemModeUser, content: "You are a system dynamics modeling assistant." },
        { role: "user", content: cleanPrompt },
      ],
      response_format: schema,
    });

    const parsed = completion.choices[0].message.parsed || JSON.parse(completion.choices[0].message.content);
    return parsed.relationships || [];
  }

  async adjustPolarities(relationships, prompt, wrapper) {
    if (!relationships || relationships.length === 0) return relationships;

    const schema = wrapper.generateSDJSONResponseSchema();
    const polishPrompt = `Given the following text: """${prompt}"""
And the following causal relationships:

${JSON.stringify(relationships, null, 2)}

Check the polarity for each relationship based on the cause and effect. Make sure:
- "+" means they change in the same direction
- "-" means they change in opposite directions
Update polarityReasoning if needed.
Return the adjusted relationships as a JSON array in the same format.`;

    const completion = await wrapper.openAIAPI.chat.completions.create({
      model: wrapper.model.name,
      temperature: 0,
      messages: [
        { role: wrapper.model.systemModeUser, content: "You are a system dynamics modeling assistant." },
        { role: "user", content: polishPrompt },
      ],
      response_format: schema,
    });

    const parsed = completion.choices[0].message.parsed || JSON.parse(completion.choices[0].message.content);
    return parsed.relationships || [];
  }
}

export default RecursiveCausalEngine;
