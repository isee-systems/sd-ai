import Engine from '../default/engine.js';
import AdvancedEngineBrain from '../default/AdvancedEngineBrain.js';
import { LLMWrapper } from '../../utils.js';

class RecursiveCausalEngine extends Engine {
  additionalParameters() {
    return super.additionalParameters().concat([
      {
        name: "mainTopics",
        type: "string",
        required: false,
        uiElement: "textarea",
        saveForUser: "local",
        label: "Main Topics",
        description: "Comma-separated list of main variables or topics to explore. Leave empty to auto-infer.",
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
      let mainTopics = (parameters.mainTopics || "")
        .split(',')
        .map(x => x.trim().toLowerCase())
        .filter(x => x.length > 0);

      if (mainTopics.length === 0 || mainTopics.includes("infer topic")) {
        const topicBrain = new AdvancedEngineBrain({
          ...parameters,
          systemPrompt: "You are a system dynamics assistant. Identify the main variable or topic discussed in the prompt below.",
          problemStatement: prompt,
        });

        const inferencePrompt = `Given the following background information:\n"""\n${prompt}\n"""\nIdentify the single most central concept or variable that all other ideas revolve around. Return only a comma-separated list of 1–3 key topics.`;

        const result = await topicBrain.generateDiagram(inferencePrompt, { relationships: [] });
        if (Array.isArray(result.relationships) && result.relationships.length > 0) {
          mainTopics = result.relationships.map(r => r.from.toLowerCase());
        } else {
          throw new Error("Failed to infer main topics.");
        }
      }

      const maxDepth = parameters.depth;
      const explored = new Set();
      let allRelationships = [];

      const recursiveBrain = new AdvancedEngineBrain({
        ...parameters,
        systemPrompt: "You are a System Dynamics Assistant. Given a topic and source text, extract causal relationships.",
        problemStatement: prompt,
      });

      const exploreTopic = async (topic, depth) => {
        if (depth > maxDepth || explored.has(topic)) return;
        explored.add(topic);

        const topicPrompt = `Given the following text:"""\n${prompt}\n"""\nIdentify causes (drivers) and effects (impacts) of the topic: "${topic}" present in the text. If there are no causes or effects, return an empty array.\nReturn the relationships as a JSON array where each relationship has:\n- from: variable (short, neutral noun phrase, 5 words or fewer)\n- to: variable (short, neutral noun phrase, 5 words or fewer)\n- polarity: + or -\n- reasoning: why this relationship exists\n- polarityReasoning: why this polarity (+ or -) is appropriate.`;

        const result = await recursiveBrain.generateDiagram(topicPrompt, { relationships: [] });
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

      const cleaned = await this.cleanRelationships(allRelationships, prompt, parameters);
      const polished = await this.adjustPolarities(cleaned, prompt, parameters);
      const variables = [...new Set(polished.flatMap(r => [r.from, r.to]))];

      return {
        supportingInfo: {
          explanation: "Recursive causal relationships extracted and polished up to specified depth.",
          title: "Recursive Causal Map"
        },
        model: {
          relationships: polished,
          variables
        }
      };
    } catch (err) {
      console.error(err);
      return { err: err.toString() };
    }
  }

  async cleanRelationships(relationships, prompt, parameters) {
    if (!relationships || relationships.length === 0) return relationships;

    const cleaningBrain = new AdvancedEngineBrain({
      ...parameters,
      systemPrompt: "You are a system dynamics assistant who improves variable naming and eliminates redundant links.",
      problemStatement: prompt
    });

    const cleanPrompt = `Given the following text: """${prompt}"""\nAnd the following causal relationships:\n${JSON.stringify(relationships, null, 2)}\n\nPlease:\n1. Normalize variable names (short, neutral phrases, 3 words or fewer)\n2. Merge variables that refer to the same thing\n3. Remove duplicate or redundant relationships\nReturn the cleaned relationships as a JSON array in the same format.`;

    const result = await cleaningBrain.generateDiagram(cleanPrompt, { relationships });
    return result.relationships || [];
  }

  async adjustPolarities(relationships, prompt, parameters) {
    if (!relationships || relationships.length === 0) return relationships;

    const polarityBrain = new AdvancedEngineBrain({
      ...parameters,
      systemPrompt: "You are a system dynamics expert that double-checks polarity logic between cause and effect variables.",
      problemStatement: prompt
    });

    const polishPrompt = `Given the following text: """${prompt}"""\nAnd the following causal relationships:\n${JSON.stringify(relationships, null, 2)}\n\nCheck the polarity for each relationship based on the cause and effect. Make sure:\n- "+" means they change in the same direction\n- "-" means they change in opposite directions\nUpdate polarityReasoning if needed.\nReturn the adjusted relationships as a JSON array in the same format.`;

    const result = await polarityBrain.generateDiagram(polishPrompt, { relationships });
    return result.relationships || [];
  }
}

export default RecursiveCausalEngine;
