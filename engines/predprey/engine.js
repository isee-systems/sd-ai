export function additionalParameters () {
    return []
} 

export async function generate(prompt, currentModel) {
    return {
        variables: [
            {
                name: "predator",
                type: "variable"
            },
            {
                name: "prey",
                type: "variable"
            }
        ],
        relationships: [
            {
                start: "predator",
                end: "prey",
                polarity: "-"
            },
            {
                start: "prey",
                end: "predator",
                polarity: "+"
            }
        ]
    }
}