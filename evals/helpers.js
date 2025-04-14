import Table  from 'cli-table3';
import dataForge from 'data-forge';
import fs from 'fs';

export const uniqueFileId = function(path="./") {
    // generate 3 random lowercase letters

    const fileExists = function(substring) {
        // read all files in a directory and see if their path contains the substring
        const files = fs.readdirSync(path);
        return files.some(f => f.includes(substring));
    }
    // if you ran this once every 2 minutes
    // if would take about 16 hours before you had a 1% chance of collision
    // https://zelark.github.io/nano-id-cc/
    // but we check for collisions anyway to be safe
    
    // if the file exists, generate a new one
    let uniqueRandomId = "" 
    do {
        uniqueRandomId = Math.random().toString(36).slice(2, 5);
    } while (fileExists(uniqueRandomId))
    return uniqueRandomId
}


export const printTable = function(results) {
    const table = new Table({
        head: results.getColumnNames()
    });
    table.push(...results.toRows());
    console.log(table.toString());
}

export function pivotAndUnstack(dfIn, rowsName, colsName, valsName, valAggFunc) {
    // Return a new df that is like pandas "pivot_table" output.
    // Pandas equivalent syntax:
    //      df.pivot_table(index=[rowsName], columns=[colsName],   \
    //          values=valsName, aggfunc=valAggFunc).reset_index()
    // Differences: 
    //  * This function does not make any changes to the index, but instead keeps the
    //      rowsName data in the first column. Alternatively, move rowsName col to index via:
    //               .setIndex(rowsName)
    //               .dropSeries(rowsName)
    //  * This function does not handle multi-levels of pivot/multiIndex.
    //
    // Input:
    //  * 'rowsName' [string] is the name of the column in dfIn whose unique values
    //      will become the values in the first column of dfOut.
    //  * 'colsName' [string] is the name of the column in dfIn whose unique values
    //      will become the column names (along with rowsName) of dfOut.
    //  * 'valsName' [string] is the name of the column in dfIn that will be aggregated
    //      to form the "field" of dfOut, corresponding to row/col name pair.
    //  * 'valAggFunc' [function] is the aggregator acting on values in 'valsName' column.
    // Output:
    //  The df, as described above.
        
    const dfPivoted = dfIn.pivot([rowsName, colsName], valsName, valAggFunc);
    let dfOut = unstack(dfPivoted, rowsName, colsName, valsName);
    return dfOut;
}

export function unstack(dfPivoted, rowsName, colsName, valsName) { 
    // See description in pivotAndUnstack().
    // Note that unstack() is basically the opposite of melt().  If we do:
    //      let dfIn = ... some df
    //   => let dfPivoted = dfIn.pivot([rowsName, colsName], valsName, valAggFunc);
    //      let dfUnstacked = unstack(dfPivoted, rowsName, colsName, valsName);
    //      let uniqueCols = dfPivoted.deflate(row => row[colsName]).distinct().toArray();
    //   => let dfMelted = dfUnstacked.melt('Date', uniqueCols);
    // Then dfPivoted should be the same as dfMelted.

    let unstackedData = [];
    let prevRowsName, newRow;

    // Make sure all entries in colsName are present on first row,
    //   otherwise any missing entries seem to be excluded?
    let uniqueCols = dfPivoted.deflate(row => row[colsName]).distinct();
    let newRowStarter = {[rowsName]: undefined};
    uniqueCols.forEach(colName => {
        newRowStarter[colName] = undefined;
    });

    dfPivoted.forEach(row => {
        // Keep filling the "field" until we have a new value in rowsName
        if (row[rowsName] !== prevRowsName) {       // It's a new row
            prevRowsName = row[rowsName];
            newRow = {...newRowStarter };
            newRow[rowsName] = row[rowsName];

            unstackedData.push(newRow);
        }
        newRow[row[colsName]] = row[valsName];
    });

    let unstackedDf = new dataForge.DataFrame({ values: unstackedData });
    return unstackedDf;
}