# Testing Guide & Datasets

To test that your **Add (POST)**, **Edit (PUT)**, and **Delete (DELETE)** routes are working on the live server, you can use the datasets and scripts below.

## 1. Helper Script (Run in Browser Console)

Since your backend is an API (no frontend UI for editing yet), you can test directly from your browser's Developer Tools.

1. Go to: [https://sg-green-plan-server.onrender.com/points](https://sg-green-plan-server.onrender.com/points)
2. Right-click anywhere > **Inspect** > Go to **Console** tab.
3. Paste the following code and hit Enter:

```javascript
/* ----------------------------------------------------
   Browser Test Script for SG Green Plan API
   ---------------------------------------------------- */
const baseUrl = 'https://sg-green-plan-server.onrender.com';

async function testApi() {
    console.log(`%c 🚀 Testing API at ${baseUrl}...`, 'color: cyan; font-weight: bold;');

    // ============================================
    // TEST 1: POINTS (Add -> Edit -> Delete)
    // ============================================
    console.log(`%c \n--- TEST 1: POINTS ---`, 'font-weight: bold;');
    
    // 1. ADD POINT
    const newPoint = {
        name: "TEST_POINT_" + Date.now(),
        address: "123 Test Avenue, Singapore",
        postal_code: "123456",
        latitude: 1.3521,
        longitude: 103.8198
    };

    console.log(`%c 1. Adding Point...`, 'color: yellow;');
    let res = await fetch(`${baseUrl}/points`, {
        method: 'POST', body: JSON.stringify(newPoint),
        headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) { console.error("❌ Add Point Failed", await res.text()); return; }
    let data = await res.json();
    const pointId = data.id;
    console.log(`✅ Added Point! ID: ${pointId}`);

    // 2. EDIT POINT
    console.log(`%c 2. Updating Point (ID: ${pointId})...`, 'color: orange;');
    res = await fetch(`${baseUrl}/points/${pointId}`, {
        method: 'PUT', body: JSON.stringify({ ...newPoint, name: newPoint.name + " (UPDATED)" }),
        headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) { console.error("❌ Update Point Failed", await res.text()); return; }
    console.log(`✅ Updated Point!`);

    // ============================================
    // TEST 2: LOGS (Add -> Edit -> Delete)
    // ============================================
    console.log(`%c \n--- TEST 2: LOGS ---`, 'font-weight: bold;');

    // 1. ADD LOG
    // Note: Assuming we have a valid point_id (we just made one) and material_id (usually 1-5 from generic types)
    // We will use pointId from above and material_id: 1 (Paper)
    const newLog = {
        point_id: pointId,
        material_id: 1, 
        weight_kg: 5.5
    };

    console.log(`%c 1. Adding Log...`, 'color: yellow;');
    res = await fetch(`${baseUrl}/logs`, {
        method: 'POST', body: JSON.stringify(newLog),
        headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) { console.error("❌ Add Log Failed", await res.text()); }
    else {
        console.log(`✅ Added Log! (Fetching ID...)`);
        
        // Wait a bit for DB consistency
        await new Promise(r => setTimeout(r, 1000));
        
        // Fetch logs to find our log
        const logsRes = await fetch(`${baseUrl}/logs`);
        const logs = await logsRes.json();
        const myLog = logs[0]; // Assuming the latest log is ours (since we just added it)
        
        if (myLog && myLog.weight_kg == 5.5) {
             const logId = myLog.id;
             console.log(`✅ Found Log ID: ${logId}`);
             
             // 2. EDIT LOG (Correct Typo: 5.5kg -> 2.5kg)
             console.log(`%c 2. Updating Log (Fix Typo)...`, 'color: orange;');
             res = await fetch(`${baseUrl}/logs/${logId}`, {
                 method: 'PUT', 
                 body: JSON.stringify({ point_id: pointId, material_id: 1, weight_kg: 2.5 }),
                 headers: { 'Content-Type': 'application/json' }
             });
             if (res.ok) console.log("✅ Updated Log (Weight corrected to 2.5kg)!");
             else console.error("❌ Update Log Failed", await res.text());

             // 3. DELETE LOG
             console.log(`%c 3. Deleting Log...`, 'color: red;');
             res = await fetch(`${baseUrl}/logs/${logId}`, { method: 'DELETE' });
             if (res.ok) console.log("✅ Deleted Log!");
             else console.error("❌ Delete Log Failed", await res.text());
        } else {
            console.warn("⚠️ Could not verify log creation (maybe other logs came in first).");
        }
    }

    // ============================================
    // CLEANUP
    // ============================================
    console.log(`%c \n--- CLEANUP ---`, 'font-weight: bold;');
    // DELETE POINT
    console.log(`Deleting Point (ID: ${pointId})...`);
    res = await fetch(`${baseUrl}/points/${pointId}`, { method: 'DELETE' });
    if (res.ok) console.log(`✅ Point Deleted!`);
    
    console.log(`%c 🎉 ALL TESTS COMPLETED!`, 'color: lightgreen; font-weight: bold; font-size: 14px;');
}

testApi();
```

---

## 2. Manual Datasets (JSON)

### Add a Log
**POST** `https://sg-green-plan-server.onrender.com/logs`
```json
{
  "point_id": 5,
  "material_id": 2,
  "weight_kg": 10.5
}
```

### Update a Log (Fix Typo)
**PUT** `https://sg-green-plan-server.onrender.com/logs/:id`
```json
{
  "point_id": 5,
  "material_id": 2,
  "weight_kg": 1.5
}
```

### Delete a Log
**DELETE** `https://sg-green-plan-server.onrender.com/logs/:id`
