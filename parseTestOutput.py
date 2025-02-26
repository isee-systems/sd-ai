import json
import fileinput

def allEqual(iterator):
    iterator = iter(iterator)
    try:
        first = next(iterator)
    except StopIteration:
        return True
    return all(first == x for x in iterator)

def extractReason(failure):
    failureReason = 'Unknown'
    failureMsg = failure['message']

    if failureMsg.startswith('Incorrect polarity discovered'):
        failureReason = 'Polarity'
    elif failureMsg.startswith('Real relationships not found'):
        failureReason = 'Missing relationship'
    elif failureMsg.startswith('Fake relationships found'):
        failureReason = 'Fake relationship'
    elif failureMsg.startswith('Missing required variables'):
        failureReason = 'Missing required variables'
    elif failureMsg.startswith('Too many variables'):
        failureReason = 'Too many variables'
    elif failureMsg.startswith('Too few variables'):
        failureReason = 'Too few variables'
    elif failureMsg.startswith('Too many feedback loops'):
        failureReason = 'Too many feedback loops'
    elif failureMsg.startswith('Too few feedback loops'):
        failureReason = 'Too few feedback loops'

    return failureReason

print(f"LLM,Suite,Kind,Test,Status,Failure Reason")

chars = ' ,'

for line in fileinput.input():
    if line.startswith("{"):
        j = json.loads(line)
        name = j["fullName"]
        llm, suite, kind, test = name.split("|")
        status = j["status"]
        failureReason = ''

        if status != 'passed':
            failureReasons = [extractReason(f) for f in j['failedExpectations']]
            failureReason = 'Multiple Kinds of Failures'
            if allEqual(failureReasons):
                failureReason = failureReasons[0]
             
        print(f"\"{llm.strip(chars)}\",\"{suite.strip(chars)}\",\"{kind.strip(chars)}\",\"{test.strip(chars)}\",\"{status.strip(chars)}\",\"{failureReason.strip(chars)}\"")