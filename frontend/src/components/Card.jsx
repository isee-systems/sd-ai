import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Relationship from './Relationship';

// Generate a stable ID for each relationship
const getRelationshipId = (rel, index) => {
    return `${rel.from}-${rel.to}-${rel.polarity}-${index}`;
};

const DeleteZone = ({ isDragging, onAddNew }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: 'delete-zone',
    });

    return (
        <div 
            ref={setNodeRef}
            className={`mt-4 p-3 border-2 border-dashed rounded-lg transition-all ${
                isDragging 
                    ? isOver 
                        ? 'border-red-500 bg-red-100 opacity-90' 
                        : 'border-red-300 bg-red-50 opacity-70'
                    : 'border-gray-300 bg-gray-50 opacity-60'
            }`}
        >
            {isDragging ? (
                <div className="flex items-center justify-center text-red-500">
                    <div className="text-center">
                        <div className="text-lg mb-1">🗑️</div>
                        <div className="text-sm font-medium">
                            {isOver ? 'Release to delete' : 'Drag here to delete'}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-center text-gray-500">
                        <div className="flex items-center space-x-2">
                            <span className="text-sm italic">variable A</span>
                            <button className="px-2 py-1 bg-gray-200 text-gray-400 rounded text-sm cursor-default">
                                +
                            </button>
                            <span className="text-sm italic">variable B</span>
                        </div>
                    </div>
                    <div className="flex justify-center mt-2">
                        <button 
                            onClick={onAddNew}
                            className="px-4 py-2 bg-blue-100 text-blue-400 rounded-md text-sm font-medium hover:bg-blue-200 hover:text-blue-500 transition-colors cursor-pointer"
                        >
                            + Add new relationship
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

const SortableRelationship = ({ relationship, relationshipId, onRelationshipChange }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: relationshipId });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            {...attributes} 
            {...listeners}
            className="bg-white border rounded mb-2 p-2 cursor-grab active:cursor-grabbing"
        >
            <Relationship relationship={relationship} onChange={onRelationshipChange} />
        </div>
    );
};


const Card = ({ cld, updateCld }) => {
    const [mode, setMode] = useState('relationship'); // 'relationship' or 'json'
    const [title, setTitle] = useState(cld.title);
    const [jsonText, setJsonText] = useState(JSON.stringify({ relationships: cld.relationships }, null, 2));
    const [isDragging, setIsDragging] = useState(false);

    // Set up sensors for drag and drop
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Require 8px of movement before starting drag
            },
        })
    );

    useEffect(() => {
        setJsonText(JSON.stringify({ relationships: cld.relationships }, null, 2));
    }, [cld]);

    const handleDragEnd = (event) => {
        const { active, over } = event;
        setIsDragging(false);

        if (!over || active.id === over.id) return;

        // Check if dropped on delete zone
        if (over.id === 'delete-zone') {
            // Find and remove the dragged relationship
            const activeIndex = cld.relationships.findIndex((rel, index) => 
                getRelationshipId(rel, index) === active.id
            );
            if (activeIndex !== -1) {
                const newRelationships = cld.relationships.filter((_, index) => index !== activeIndex);
                updateCld({ ...cld, relationships: newRelationships });
            }
            return;
        }

        // Find the indices based on the relationship IDs
        const activeIndex = cld.relationships.findIndex((rel, index) => 
            getRelationshipId(rel, index) === active.id
        );
        const overIndex = cld.relationships.findIndex((rel, index) => 
            getRelationshipId(rel, index) === over.id
        );
        
        if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
            const newRelationships = arrayMove(cld.relationships, activeIndex, overIndex);
            updateCld({ ...cld, relationships: newRelationships });
        }
    };

    const handleDragStart = () => {
        setIsDragging(true);
    };

    const handleJsonBlur = () => {
        try {
            const parsed = JSON.parse(jsonText);
            if (parsed && parsed.relationships && Array.isArray(parsed.relationships)) {
                updateCld({ ...cld, relationships: parsed.relationships });
            } else {
                 console.error("Invalid JSON structure: 'relationships' key is missing or not an array.");
                 setJsonText(JSON.stringify({ relationships: cld.relationships }, null, 2)); // Revert
            }
        } catch (error) {
            console.error("Invalid JSON", error);
            setJsonText(JSON.stringify({ relationships: cld.relationships }, null, 2)); // Revert to last valid state
        }
    };

    const handleRelationshipChange = (oldRelationship, newRelationship) => {
        const newRelationships = cld.relationships.map(rel => {
            // Find the relationship by matching from and to since there's no unique ID
            if (rel.from === oldRelationship.from && rel.to === oldRelationship.to && rel.polarity === oldRelationship.polarity) {
                return newRelationship;
            }
            return rel;
        });
        updateCld({ ...cld, relationships: newRelationships });
    };

    const handleAddNewRelationship = () => {
        const newRelationship = {
            from: '',
            to: '',
            polarity: '+'
        };
        const newRelationships = [...cld.relationships, newRelationship];
        updateCld({ ...cld, relationships: newRelationships });
    };

    return (
        <div className="card" style={{ width: '500px', border: '1px solid #ccc', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
            <div className="card-header" style={{ padding: '10px', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => updateCld({...cld, title: title})} style={{border: 'none', fontSize: '1.2em', fontWeight: 'bold', width: '80%'}} />
                <button onClick={() => setMode(mode === 'json' ? 'relationship' : 'json')}>
                    {mode === 'json' ? 'Rel' : 'JSON'}
                </button>
            </div>
            <div className="card-details" style={{ padding: '10px' }}>
                {mode === 'json' ? (
                    <textarea
                        style={{ width: '100%', height: '300px', border: 'none', resize: 'none' }}
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        onBlur={handleJsonBlur}
                    />
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    >
                        <SortableContext
                            items={cld.relationships.map((rel, index) => getRelationshipId(rel, index))}
                            strategy={verticalListSortingStrategy}
                        >
                            {cld.relationships.map((rel, index) => {
                                const relationshipId = getRelationshipId(rel, index);
                                return (
                                    <SortableRelationship 
                                        key={relationshipId} 
                                        relationshipId={relationshipId}
                                        relationship={rel} 
                                        onRelationshipChange={(newRel) => handleRelationshipChange(rel, newRel)}
                                    />
                                );
                            })}
                        </SortableContext>
                        
                        <DeleteZone isDragging={isDragging} onAddNew={handleAddNewRelationship} />
                    </DndContext>
                )}
            </div>
        </div>
    );
};

export default Card;
