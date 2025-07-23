import { useEffect, useRef } from 'react';

/**
 * Auto-resizing textarea component that adjusts its height based on content
 * @param {Object} props - Component props
 * @param {string} props.value - The current value of the textarea
 * @param {Function} props.onChange - Function called when the textarea value changes
 * @param {string} [props.className] - Additional CSS classes to apply
 * @param {string} [props.placeholder] - Placeholder text for the textarea
 * @param {boolean} [props.required] - Whether the textarea is required
 * @param {string} [props.id] - HTML id attribute for the textarea
 * @param {string} [props.minHeight] - Minimum height for the textarea (default: '2.5rem')
 * @param {Object} [props.style] - Additional inline styles
 * @param {Object} [props.rest] - Any other props to pass to the textarea element
 */
function AutoResizeTextarea({ 
  value, 
  onChange, 
  className = '', 
  placeholder, 
  required, 
  id,
  minHeight = '2.5rem',
  style = {},
  ...rest 
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to expand to content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      id={id}
      value={value}
      onChange={onChange}
      className={`${className} resize-none overflow-hidden`}
      placeholder={placeholder}
      required={required}
      style={{ minHeight, ...style }}
      {...rest}
    />
  );
}

export default AutoResizeTextarea;
