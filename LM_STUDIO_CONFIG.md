# LM Studio Configuration for SD-AI Compatibility

## 🔧 **Critical Settings for SD-AI Integration**

### **1. Server Settings**
- **Server Port**: Ensure set to `1234` (already configured)
- **OpenAI Compatible API**: Must be **enabled**
- **CORS**: Enable if needed for web requests

### **2. Model Response Format Settings**

#### **JSON Mode Configuration**
- **Enable JSON Response Format**: Turn ON if available
- **Structured Output Support**: Enable if the model supports it
- **Response Format Enforcement**: Set to strict/enforced mode

#### **Temperature & Sampling**
- **Temperature**: Set to `0.1-0.3` for consistent structured output
- **Top-p**: Set to `0.9` or lower for more focused responses
- **Repetition Penalty**: Set to `1.1` to avoid repetitive outputs

### **3. Advanced Model Settings**

#### **System Message Support**
- **Enable System Messages**: Must be ON
- **System Message Priority**: Set to High
- **Multi-turn Conversation**: Enable for proper message handling

#### **Output Formatting**
- **Trim Whitespace**: Enable
- **Normalize Line Endings**: Enable  
- **JSON Validation**: Enable if available

### **4. API Compatibility Settings**

#### **OpenAI API Compliance**
- **Response Format**: Set to OpenAI compatible
- **Message Structure**: Standard OpenAI format
- **Error Handling**: OpenAI style error responses

#### **Content Fields**
Ensure responses include proper fields:
- `content` field for text responses
- `message` object structure matching OpenAI format
- Proper JSON parsing support

## 📋 **Configuration Checklist**

```
□ Server running on port 1234
□ OpenAI compatible API enabled
□ JSON response format enabled
□ Temperature set to 0.1-0.3
□ System messages enabled
□ Output formatting cleaned up
□ Response validation enabled
```

## ⚙️ **Model-Specific Settings for qwen3.5**

### **Prompt Template**
- Set to **ChatML** or **Alpaca** format
- Ensure system message support
- Enable instruction following mode

### **Generation Parameters**
- **Max Tokens**: 2048+ for complex JSON responses
- **Stop Sequences**: Add `}` as a stop sequence if needed
- **Context Length**: Use full context window

### **JSON Output Enhancement**
- Add JSON schema validation if supported
- Enable structured output mode for the model
- Set response format hints in the model configuration

## 🚨 **Common Issues & Fixes**

### **ResponseFormatError Solutions**
1. **Enable JSON Mode**: Force JSON responses in LM Studio
2. **System Prompt**: Add JSON formatting instructions to system prompts
3. **Temperature**: Lower temperature for more consistent formatting
4. **Model Selection**: Some models handle structured output better than others

### **Missing Content Fields**
- Ensure OpenAI API compatibility is fully enabled
- Check that response includes `content` field
- Verify message structure matches OpenAI format

## 🔄 **After Configuration Changes**

1. **Restart LM Studio server**
2. **Test with simple JSON request**: `curl -X POST http://localhost:1234/v1/chat/completions ...`
3. **Re-run SD-AI benchmark**: `npm run evals -- -e evals/experiments/local-single-model.json`
4. **Monitor for improved structured output compliance**

## 📊 **Expected Improvement**

After proper configuration, you should see:
- ✅ Reduced `ResponseFormatError` messages
- ✅ Proper JSON parsing in benchmark results  
- ✅ Models following structured output schema
- ✅ Successful evaluation completions