import json
import fileinput

for line in fileinput.input():
    if line.startswith("{"):
        j = json.loads(line)
        name = j["fullName"]
        llm, type, test = name.split("|")
        status = j["status"]
        print(f"{llm}; {type}; {test}; {status}")