import {
  ClaimRewards as ClaimRewardsEvent,
  Deposit as DepositEvent,
  FateRewardControllerProtocol
} from '../types/FateRewardController/FateRewardControllerProtocol'
import {
  Transaction,
  Claim,
  UserEpochTotalLockedRewardByPool,
  UserEpochTotalLockedReward,
  RewardMetadata, StartBlock
} from '../types/schema'
import { BigDecimal, BigInt, EthereumEvent } from '@graphprotocol/graph-ts'
import { getFatePriceUsd } from './pricing'
import { BLOCKS_PER_WEEK, ONE_BD, ONE_BI, TWO_BI, ZERO_BD, ZERO_BI } from './helpers'
import { Bytes } from '@graphprotocol/graph-ts/index'

let ONE_ETH_IN_WEI = BigDecimal.fromString('1000000000000000000')

function getIdByUserAndPool(user: Bytes, poolId: BigInt, epoch: BigInt): string {
  return user.toHexString().concat('-').concat(poolId.toString()).concat('-').concat(epoch.toString())
}

function getIdByUser(user: Bytes, epoch: BigInt): string {
  return user.toHexString().concat('-').concat(epoch.toString())
}

function getOrFindStartBlock(event: EthereumEvent): BigInt {
  let startBlockEntity = StartBlock.load(event.address.toHexString())
  if (startBlockEntity == null) {
    let controllerProtocol = FateRewardControllerProtocol.bind(event.address)
    startBlockEntity = new StartBlock(event.address.toHexString())
    startBlockEntity.startBlock = controllerProtocol.startBlock()
    startBlockEntity.save()
  }
  return startBlockEntity.startBlock
}

function calculateEpochIndex(event: EthereumEvent): BigInt {
  let startBlock = getOrFindStartBlock(event)
  return event.block.number.minus(startBlock).div(BLOCKS_PER_WEEK)
}

function mapEpochIndexToEpoch(index: BigInt): BigInt {
  if (index.lt(BigInt.fromI32(13))) {
    return ZERO_BI
  } else if (index.lt(BigInt.fromI32(21))) {
    return ONE_BI
  } else {
    return TWO_BI
  }
}

function getOrCreateMetadata(): RewardMetadata {
  let metadata = RewardMetadata.load('0')
  if (metadata == null) {
    metadata = new RewardMetadata('0')
    metadata.claimCount = ZERO_BI
    metadata.fateClaimed = ZERO_BD
    metadata.fateClaimedUsd = ZERO_BD
    metadata.numberOfUniqueUsers = ZERO_BI
  }
  return metadata as RewardMetadata
}

function getAndSaveTransaction(event: EthereumEvent): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction == null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.save()
  }
}

export function handleDeposit(event: DepositEvent): void {
  getAndSaveTransaction(event)

  let user = event.params.user
  let poolId = event.params.pid
  let epoch = mapEpochIndexToEpoch(calculateEpochIndex(event))

  let userRewardsByPool = UserEpochTotalLockedRewardByPool.load(getIdByUserAndPool(user, poolId, epoch))
  if (userRewardsByPool == null) {
    userRewardsByPool = new UserEpochTotalLockedRewardByPool(getIdByUserAndPool(user, poolId, epoch))
    userRewardsByPool.user = user
    userRewardsByPool.poolId = poolId
    userRewardsByPool.amountFate = ZERO_BD
    userRewardsByPool.amountUSD = ZERO_BD
    userRewardsByPool.save()
  }

  let userRewards = UserEpochTotalLockedReward.load(getIdByUser(user, epoch))
  let isNewUser = false
  if (userRewards == null) {
    isNewUser = true
    userRewards = new UserEpochTotalLockedReward(getIdByUser(user, epoch))
    userRewards.user = user
    userRewards.amountFate = ZERO_BD
    userRewards.amountUSD = ZERO_BD
    userRewards.save()
  }

  let metadata = getOrCreateMetadata()

  if (isNewUser) {
    metadata.numberOfUniqueUsers = metadata.numberOfUniqueUsers.plus(ONE_BI)
    metadata.save()
  }
}

export function handleClaimRewards(event: ClaimRewardsEvent): void {
  getAndSaveTransaction(event)

  let claim = new Claim(event.transaction.hash.toHexString().concat('-').concat(event.logIndex.toString()))
  claim.timestamp = event.block.timestamp
  claim.transaction = event.transaction.hash.toHexString()
  claim.user = event.params.user
  claim.poolId = event.params.pid
  claim.amountFate = event.params.amount.divDecimal(ONE_ETH_IN_WEI)
  claim.amountUSD = claim.amountFate.times(getFatePriceUsd())

  let metadata = getOrCreateMetadata()
  metadata.claimCount = metadata.claimCount.plus(ONE_BI)
  metadata.fateClaimed = metadata.fateClaimed.plus(claim.amountFate)
  metadata.fateClaimedUsd = metadata.fateClaimedUsd.plus(claim.amountUSD)

  let index = calculateEpochIndex(event)
  let epoch = mapEpochIndexToEpoch(index)

  let lockMultiplier: BigDecimal
  if (epoch.equals(ZERO_BI)) {
    // the amount locked is 4x the claim amount (due to 80% lock) (80% / 20%)
    lockMultiplier = BigDecimal.fromString('4')
  } else if (epoch.equals(ONE_BI)) {
    // the amount locked is 11.5 the claim amount (due to 92% lock) (92% / 8%)
    lockMultiplier = BigDecimal.fromString('115')
  } else {
    lockMultiplier = ZERO_BD
  }

  let lockDivisor: BigDecimal
  if (epoch.equals(ZERO_BI)) {
    lockDivisor = ONE_BD
  } else if (epoch.equals(ONE_BI)) {
    lockDivisor = BigDecimal.fromString('10')
  } else {
    lockDivisor = ONE_BD
  }

  let userRewardsByPool = UserEpochTotalLockedRewardByPool.load(getIdByUserAndPool(claim.user, claim.poolId, epoch))
  if (userRewardsByPool == null) {
    userRewardsByPool = new UserEpochTotalLockedRewardByPool(getIdByUserAndPool(claim.user, claim.poolId, epoch))
    userRewardsByPool.user = claim.user
    userRewardsByPool.poolId = claim.poolId
    userRewardsByPool.amountFate = ZERO_BD
    userRewardsByPool.amountUSD = ZERO_BD
  }
  userRewardsByPool.amountFate = userRewardsByPool.amountFate.plus(claim.amountFate.times(lockMultiplier).div(lockDivisor))
  userRewardsByPool.amountUSD = userRewardsByPool.amountUSD.plus(claim.amountUSD.times(lockMultiplier).div(lockDivisor))

  let userRewards = UserEpochTotalLockedReward.load(getIdByUser(claim.user, epoch))
  let isNewUser = false
  if (userRewards == null) {
    isNewUser = true
    userRewards = new UserEpochTotalLockedReward(getIdByUser(claim.user, epoch))
    userRewards.user = claim.user
    userRewards.amountFate = ZERO_BD
    userRewards.amountUSD = ZERO_BD
  }
  userRewards.amountFate = userRewards.amountFate.plus(claim.amountFate.times(lockMultiplier).div(lockDivisor))
  userRewards.amountUSD = userRewards.amountUSD.plus(claim.amountUSD.times(lockMultiplier).div(lockDivisor))

  if (isNewUser) {
    metadata.numberOfUniqueUsers = metadata.numberOfUniqueUsers.plus(ONE_BI)
  }

  metadata.save()
  userRewardsByPool.save()
  userRewards.save()
  claim.save()
}
