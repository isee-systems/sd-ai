import React, { useState, useEffect } from 'react';

const Relationship = ({ relationship, onChange }) => {
  const [editingField, setEditingField] = useState(null); // 'from', 'to', or null
  const [localFrom, setLocalFrom] = useState(relationship.from);
  const [localTo, setLocalTo] = useState(relationship.to);

  const handleBlur = (field) => (e) => {
    // Only exit edit mode if we're not focusing on another input within this component
    const currentTarget = e.currentTarget;
    const relatedTarget = e.relatedTarget;
    
    // If the related target is not within the same component, exit edit mode
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setEditingField(null);
      // Apply changes when exiting edit mode
      if (field === 'from') {
        onChange({ ...relationship, from: localFrom });
      } else if (field === 'to') {
        onChange({ ...relationship, to: localTo });
      }
    }
  };

  const togglePolarity = (e) => {
    e.stopPropagation(); // prevent the parent onClick from firing
    const newPolarity = relationship.polarity === '+' ? '-' : '+';
    onChange({ ...relationship, polarity: newPolarity });
  };

  const handleFromChange = (newFrom) => {
    setLocalFrom(newFrom);
  };

  const handleToChange = (newTo) => {
    setLocalTo(newTo);
  };

  const handleKeyDown = (field) => (e) => {
    if (e.key === 'Enter') {
      setEditingField(null);
      if (field === 'from') {
        onChange({ ...relationship, from: localFrom });
      } else if (field === 'to') {
        onChange({ ...relationship, to: localTo });
      }
    }
  };

  // Update local state when relationship prop changes
  useEffect(() => {
    setLocalFrom(relationship.from);
    setLocalTo(relationship.to);
  }, [relationship.from, relationship.to]);

  return (
    <div className="flex items-center p-2 rounded">
      {editingField === 'from' ? (
        <input
          type="text"
          value={localFrom}
          onChange={(e) => handleFromChange(e.target.value)}
          onKeyDown={handleKeyDown('from')}
          onBlur={handleBlur('from')}
          autoFocus
          className="p-1 border rounded flex-1 text-sm bg-blue-50 border-blue-200"
        />
      ) : (
        <div 
          onClick={() => setEditingField('from')}
          className="p-1 flex-1 min-w-0 text-sm cursor-pointer hover:bg-gray-50 rounded"
        >
          {relationship.from}
        </div>
      )}
      
      <button 
        onClick={togglePolarity} 
        className="p-1 mx-2 border rounded text-sm min-w-[30px] hover:bg-gray-100"
      >
        {relationship.polarity}
      </button>
      
      {editingField === 'to' ? (
        <input
          type="text"
          value={localTo}
          onChange={(e) => handleToChange(e.target.value)}
          onKeyDown={handleKeyDown('to')}
          onBlur={handleBlur('to')}
          autoFocus
          className="p-1 border rounded flex-1 text-sm bg-blue-50 border-blue-200"
        />
      ) : (
        <div 
          onClick={() => setEditingField('to')}
          className="p-1 flex-1 min-w-0 text-sm cursor-pointer hover:bg-gray-50 rounded"
        >
          {relationship.to}
        </div>
      )}
    </div>
  );
};

export default Relationship;
