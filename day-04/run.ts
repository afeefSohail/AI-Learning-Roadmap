import { extract } from "./extractor";
import { ReceiptSchema } from "./schemas";

async function run() {
    
    const inputs : Record<string, string> = {
        discount: `Tea House: 2x tea @ 3.00, 1x cake @ 5.00, discount -2.00, tax 0.00, total 9.00 USD, 2026-10-27.`,
        clean: `Cafe Lahore, 2026-10-20. 2x Karak chai @ 3.50, 1x Paratha @ 6.00. Tax 1.30. Total 14.30 USD.`,
        messy: `*** RECEIPT *** al-fatah mart  26/10/26
        milk 1l  x2   190.00
        eggs dz  x1   420.50
        GST 17%  ...  103.50
        TOTL  PKR  904.00`,
        notAReceipt: `Hey, are we still meeting at the cafe tomorrow? Bring the laptop.`,
    };

    for (const [key, text] of Object.entries(inputs)) {
        for ( const useSchema of [true, false]) {
            const label = `${key} | ${useSchema ? "schema" : "prompt-only"}`;        
            
            try {
                const result = await extract(ReceiptSchema, text, { useSchema });
                console.log(`✅ ${label} | attempts: ${result.attempts} | tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
                console.log(JSON.stringify(result.data));
            } catch (error) {
                console.log(`❌ ${label} | ${error instanceof Error ? error.message : error}`);
            }
            console.log("--------------------------------------------------");
        }
    }
}

run();