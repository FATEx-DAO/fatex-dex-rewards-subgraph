import {
  ClaimRewards as ClaimRewardsEvent,
  Deposit as DepositEvent,
  FateRewardControllerProtocol
} from '../types/FateRewardController/FateRewardControllerProtocol'
import {
  Claim,
  RewardMetadata,
  StartBlock,
  Transaction,
  UserEpochTotalLockedReward,
  UserEpochTotalLockedRewardByPool
} from '../types/schema'
import { BigDecimal, BigInt, EthereumEvent } from '@graphprotocol/graph-ts'
import { getFatePriceUsd } from './pricing'
import { BLOCKS_PER_WEEK, ONE_BD, ONE_BI, TWO_BI, ZERO_BD, ZERO_BI } from './helpers'
import { Bytes } from '@graphprotocol/graph-ts/index'

let ONE_ETH_IN_WEI = BigDecimal.fromString('1000000000000000000')

class UserRewardsByPoolWrapper {
  userRewardsByPool: UserEpochTotalLockedRewardByPool
  isNew: boolean

  constructor(userRewardsByPool: UserEpochTotalLockedRewardByPool, isNew: boolean) {
    this.userRewardsByPool = userRewardsByPool
    this.isNew = isNew
  }
}

class UserRewardsWrapper {
  userRewards: UserEpochTotalLockedReward
  isNew: boolean

  constructor(userRewards: UserEpochTotalLockedReward, isNew: boolean) {
    this.userRewards = userRewards
    this.isNew = isNew
  }
}

function getRewardsByUserAndPool(user: Bytes, poolId: BigInt, epoch: BigInt): UserRewardsByPoolWrapper {
  let id = user.toHexString().concat('-').concat(poolId.toString()).concat('-').concat(epoch.toString())
  let userRewardsByPool = UserEpochTotalLockedRewardByPool.load(id)
  let isNew = false
  if (userRewardsByPool == null) {
    isNew = true
    userRewardsByPool = new UserEpochTotalLockedRewardByPool(id)
    userRewardsByPool.user = user
    userRewardsByPool.poolId = poolId
    userRewardsByPool.epoch = epoch.toI32()
    userRewardsByPool.amountFate = ZERO_BD
    userRewardsByPool.amountUSD = ZERO_BD
  }
  return new UserRewardsByPoolWrapper(userRewardsByPool as UserEpochTotalLockedRewardByPool, isNew)
}

function getRewardsByUser(user: Bytes, epoch: BigInt): UserRewardsWrapper {
  let id = user.toHexString().concat('-').concat(epoch.toString())
  let userRewards = UserEpochTotalLockedReward.load(id)
  let isNew = false
  if (userRewards == null) {
    isNew = true
    userRewards = new UserEpochTotalLockedReward(id)
    userRewards.user = user
    userRewards.epoch = epoch.toI32()
    userRewards.amountFate = ZERO_BD
    userRewards.amountUSD = ZERO_BD
  }
  return new UserRewardsWrapper(userRewards as UserEpochTotalLockedReward, isNew)
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

  let userRewardsByPoolWrapper = getRewardsByUserAndPool(user, poolId, epoch)
  if (userRewardsByPoolWrapper.isNew) {
    userRewardsByPoolWrapper.userRewardsByPool.save()
  }

  let userRewardsWrapper = getRewardsByUser(user, epoch)
  if (userRewardsWrapper.isNew) {
    userRewardsWrapper.userRewards.save()
  }

  let metadata = getOrCreateMetadata()
  if (userRewardsWrapper.isNew) {
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

  let userRewardsByPoolWrapper = getRewardsByUserAndPool(claim.user, claim.poolId, epoch)
  let userRewardsByPool = userRewardsByPoolWrapper.userRewardsByPool
  userRewardsByPool.amountFate = userRewardsByPool.amountFate.plus(claim.amountFate.times(lockMultiplier).div(lockDivisor))
  userRewardsByPool.amountUSD = userRewardsByPool.amountUSD.plus(claim.amountUSD.times(lockMultiplier).div(lockDivisor))

  let userRewardsWrapper = getRewardsByUser(claim.user, epoch)
  let userRewards = userRewardsWrapper.userRewards
  userRewards.amountFate = userRewards.amountFate.plus(claim.amountFate.times(lockMultiplier).div(lockDivisor))
  userRewards.amountUSD = userRewards.amountUSD.plus(claim.amountUSD.times(lockMultiplier).div(lockDivisor))

  let metadata = getOrCreateMetadata()
  metadata.claimCount = metadata.claimCount.plus(ONE_BI)
  metadata.fateClaimed = metadata.fateClaimed.plus(claim.amountFate)
  metadata.fateClaimedUsd = metadata.fateClaimedUsd.plus(claim.amountUSD)
  if (userRewardsWrapper.isNew) {
    metadata.numberOfUniqueUsers = metadata.numberOfUniqueUsers.plus(ONE_BI)
  }

  metadata.save()
  userRewardsByPool.save()
  userRewards.save()
  claim.save()
}
