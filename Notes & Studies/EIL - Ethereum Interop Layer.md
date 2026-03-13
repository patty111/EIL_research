---
tags:
  - imtoken
  - EIL
  - web3
  - blockchain
  - ETH
  - study
Create Date:
referrence link:
  - https://unchainedcrypto.com/podcast/eths-http-moment-how-ethereum-interop-layer-hopes-to-fix-l2-fragmentation/
video link: https://www.youtube.com/watch?v=o8tjvpFeiz0
---
好處是可以 bundle 處理 multiple steps cross chain


Wanted seamless UX without using new trust assumptions.
	-> There are so many chains and people are crossing between different chains. Needs a standard for the interop, which serves like a precursor. The target is to let the standards remove chain awareness, like send to an address (alice.arb.eth to bob.base.eth) instead of "0x..."
- An onchain config that gives a centralized place to look for onchain info about a chain, so the wallet can resolve the information even they do not know it yet. - discovery of chain
-> After discovery of chains, how do we move assets across them? Observing existing tools, the builders are not satisfied, which is the reason they built EIL, the tool without the need of any intermediaries.

Trust Assumptions: just like getting RPC data, we would want to have something like a client side contract so we can verify it without needing to blindly trusting the RPC.

## Now and the Future
rollups are fragmented
once you need tx cross rollups, we need to bridge our assets to pay the gases. We wait and hope. It requires 2 signatures, 1 on the origin chain 1 on dest chain. There is a lot of frictions. We can "feel" moving the assets.

The target is let the user to sign an operation regardless how many chains involved.The wallet will show the operations but only once in a compact place(?) and the user just sign it.


---

## EIL - Account based interop 
-> moving the interop to the wallet level or the user's hand instead of just passing messages
-> the wallet should become the user agent instead to have a server operate by user's behalf. The complex part is who pays for the gas and how do we move assets across chains. 
-> EIL uses paymaster contracts (ERC 437), the liquidity providers provides liquidity via atomic swap:
User don't need to expose intention, they requests: "Hey! I want 0.01 Eth on X chain to pay for something for gas." 

The provider gives something like a signed voucher, the user can use this voucher directly at the destination chain for gas.

This process does not expose user info, intentions, and does not require any direct connections because all process are on chain.

## Comparing Solver based models with EIL
#### Solver Based Model
User: U Solver: S

U: sends a request with the intent: "I want Swap 1 Eth to USDC on Arb, then send 100 USDC to alice.base.eth". This is like putting your message inside an envelop and passes it to a Solver
S: Opens the envelop, reads the intent and operate accordingly.

-> Trust Assumption: The solver knows the user's intent. Now the solver can frontrun the user, do not fill this intent, the solver can also have the user's IP and some other information. And this is the part EIL are trying to avoid

#### EIL Model
The user buys an empty Envelop from the Solver that already contains the post stamps 郵票 (gas fee like 1 usdc), the dest chain (to Arb), and the amount (send 1000 usdc). The Solver does not know who you are, who your friend is and what your are going to do with the money on the dest chain.
##### Another Example
The old Solver based model is like buying a bus ticket from Frankfurt, Germany to Paris, France. The bus driver knows my route, my personal info and my destination. He can decide to stop the bus, calls me off the bus, goes for reroute and I couldn't do anything.

The EIL approach is like I am driving my own car and goes to a gas station. The station is the liquidity provider. It does not know my destination or who I am. They just choose whether they will sell me the gas. The rest of my trip is still on my own and does not rely on any others.

---

EIL is more like the transportation layer, using a transaction-level, account-based approach. We drops the advantage of the power of intent and let DApps and wallets specify exact calls. The Intent layer can still be built on top of EIL


> EIL can be used on any EVM chain because it is essentially a smart contract

## HTTP Analogy



## 適合與不適合
EIL 看起來比較適合單使用者 transaction, 但像是 multiple user transaction 就不適合 -> cow swap

> Yoav: Use cases where there is information asymmetry inherit to the use case. This is where intents excel.

像是 cow swap 或是 AMM order book(訂單簿), user 沒有同樣程度的information level, 就適合用 Intents 而非 EIL.

Intents can let users communicate with other parties that has more info than the user. Such as knowing the entire order book and match the user with counterparties and get the best deal for teh user. But as long as the user has all the information, know exactly what they wanted to do, than EIL will be more suitable. Just as the info stated in the above article, EIL is more on the transaction-level. The operations are atomic.

!!
-> 還是會有搶跑的問題，代理人不搶跑，但大家還是可以在鏈上mempool看到啊？似乎沒有比較安全？
搶跑還是存在，只是移到使用者身上

-> Intent vs EIL 
**EIL 交易掌握在自己手中，果農自己決定 -> 利潤比較高，原因是"搶跑"
Intent 比較像是交給大盤商**

eth to usdc, 交給 intent, 利潤會被 intent 拿走，因為他們幫我們 pair, 他可以搶跑啊，立刻用 ｕｓｄｃ把 eth 買回來，這個利潤就被他們吃掉了，錢包傷自己做主動權就在自己手上

-> EIL 會對錢包商比較好


好處是可以有自動化的RPC provider，但現在不是啊，都是用 alchemy那些的。防護有跟沒有一樣啊
上面寫的都是一些"理論上"的優點



> Changwu: 工作原理先寫，感覺我現在寫的有問題

Todo:
完整的工作報告
工作原理介紹
你對於系統的觀點
覺得好的
覺得不像他說的那麼理想的
對於現況 interop UX 的改善

