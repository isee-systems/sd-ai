/**
 * Plural tolerant variable name matching for the evals which use gibberish variables.
 *
 * Those evals describe their ground truth to the LLM in english prose which pluralizes every
 * gibberish noun, so the names which come back may be the plural the LLM read, the singular it
 * inferred, or a regularized plural of its own making ("priarys" where the prose said "priaries").
 * All of those name the same variable, so every comparison against the ground truth has to see
 * through the difference no matter which side of it the ground truth was written on.
 *
 * @module utilities/nameMatching
 */

import pluralize from 'pluralize';
import utils from '../../utilities/utils.js';

/**
 * The forms a single word can take once pluralization is accounted for.  The suffix rules carry
 * the gibberish nouns, whose plurals pluralize() cannot always round trip -- "loopnova" pluralizes
 * to itself, "ku" pluralizes to "kus" and "kus" on to "kuses" -- while pluralize() carries the
 * irregular english words that show up in the pre-existing models the iteration tests hand over.
 * @param {String} word A single lower case word
 * @returns {Set<String>} Every form of that word
 */
const wordForms = function(word) {
    const forms = new Set([word, pluralize(word)]);

    if (word.endsWith("ies"))
        forms.add(word.slice(0, -3) + "y");

    if (word.endsWith("es"))
        forms.add(word.slice(0, -2));

    if (word.endsWith("s") && !word.endsWith("ss"))
        forms.add(word.slice(0, -1));

    return forms;
};

//a long descriptive name would explode the combinations below, so stop expanding once we have
//more forms than any real variable name needs and leave the remaining words as they were written
const maxNameForms = 64;

/**
 * Every form a whole variable name can take.  A name can hold several words which are each
 * pluralized independently ("priaries.frimbulators count"), so every combination is expanded.
 * @param {String} name The variable name
 * @returns {Set<String>} Every normalized form of that name
 */
export const nameForms = function(name) {
    let forms = [""];

    //splitting on a capturing group keeps the separators, so words and punctuation alternate
    for (const part of name.toLowerCase().split(/([a-z]+)/)) {
        if (!/^[a-z]+$/.test(part)) {
            forms = forms.map((form) => { return form + part });
            continue;
        }

        const words = forms.length <= maxNameForms ? [...wordForms(part)] : [part];
        const expanded = [];
        for (const form of forms) {
            for (const word of words)
                expanded.push(form + word);
        }
        forms = expanded;
    }

    return new Set(forms.map((form) => { return utils.evalsNormalizeVariableName(form) }));
};

/**
 * Checks whether two variable names are the same name, ignoring pluralization
 * @param {String} aiName The variable name from the generated model
 * @param {String} groundTruthName The expected variable name
 * @returns {boolean} True if the names differ only by pluralization
 */
export const namesEqual = function(aiName, groundTruthName) {
    const groundTruthForms = nameForms(groundTruthName);
    return [...nameForms(aiName)].some((form) => { return groundTruthForms.has(form) });
};

/**
 * Checks whether one variable name contains another, ignoring pluralization.  Used where the LLM
 * is allowed to give a variable a longer name than the ground truth one it stands for.
 * @param {String} aiName The variable name from the generated model
 * @param {String} groundTruthName The expected variable name
 * @returns {boolean} True if the ai name contains the ground truth name
 */
export const nameContains = function(aiName, groundTruthName) {
    const groundTruthForms = [...nameForms(groundTruthName)];
    return [...nameForms(aiName)].some((aiForm) => {
        return groundTruthForms.some((groundTruthForm) => { return aiForm.includes(groundTruthForm) });
    });
};

/**
 * Checks whether two variable names match, ignoring pluralization, with either one allowed to be
 * the longer of the two
 * @param {String} aiName The variable name from the generated model
 * @param {String} groundTruthName The expected variable name
 * @returns {boolean} True if either name contains the other
 */
export const namesMatch = function(aiName, groundTruthName) {
    return nameContains(aiName, groundTruthName) || nameContains(groundTruthName, aiName);
};
